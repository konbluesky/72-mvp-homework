// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BrowserPersistence,
  DraftSchema,
  ReadingHistorySchema,
  type ActiveRecovery,
} from './browser.js';
import { useConversationDisplay } from '../app/conversation-display.js';

const scenario = { id: 'sample-story', version: '1' };
const storage = (entry: 'story' | 'conversation' = 'story', origin = 'http://localhost:3000') =>
  new BrowserPersistence(origin, entry, scenario);
const recovery = (): ActiveRecovery => ({
  status: 'active',
  session: {
    sessionId: 'session',
    sessionToken: 'x'.repeat(40),
    expiresAt: Date.now() + 60000,
    mode: 'mock',
  },
  scenarioVersion: '1',
  generation: 0,
  pending: [],
  frozenTurns: [],
});
beforeEach(() => localStorage.clear());

describe('browser records', () => {
  it('keeps drafts, reading history and preferences separate from credentials and other entries', () => {
    const first = storage();
    first.claimRecovery();
    first.saveRecovery(recovery());
    first.write('draft', '还没发出去');
    first.write('history', [{ id: 1, kind: 'user', text: '你好' }]);
    first.updatePreferences({ inputMode: 'voice', characterId: 'sample-model' });
    const reopened = storage();
    expect(reopened.read('draft', DraftSchema)).toBe('还没发出去');
    expect(reopened.read('history', ReadingHistorySchema)).toHaveLength(1);
    expect(storage('conversation').read('draft', DraftSchema)).toBeUndefined();
    expect(storage('story', 'http://localhost:4000').claimRecovery()).toBeUndefined();
    reopened.clearReading();
    expect(reopened.read('draft', DraftSchema)).toBe('');
    expect(reopened.read('history', ReadingHistorySchema)).toEqual([]);
    expect(reopened.preferences()).toMatchObject({
      inputMode: 'voice',
      characterId: 'sample-model',
    });
  });

  it('rejects corrupted recovery and receipts belonging to a different session', () => {
    const first = storage();
    first.claimRecovery();
    first.saveRecovery(recovery());
    const key = localStorage.key(0)!;
    localStorage.setItem(key, '{broken');
    expect(storage().claimRecovery()).toEqual({ status: 'expired' });
    const invalid = recovery();
    invalid.pending = [
      {
        sessionId: 'another',
        generation: 1,
        turnId: 'turn',
        receiptId: 'receipt',
        targetId: 'photo',
        kind: 'photo',
        status: 'presented',
      },
    ];
    const next = storage();
    next.claimRecovery();
    next.saveRecovery(invalid);
    expect(storage().claimRecovery()).toEqual({ status: 'expired' });
  });

  it('prevents a replaced page from overwriting the new page or its cleared history', () => {
    const older = storage();
    older.claimRecovery();
    older.saveRecovery(recovery());
    const newer = storage();
    newer.claimRecovery();
    newer.write('draft', '新的草稿');
    older.saveRecovery({ status: 'expired' });
    older.write('draft', '迟到的旧草稿');
    expect(newer.read('draft', DraftSchema)).toBe('新的草稿');
    expect(newer.claimRecovery()?.status).toBe('active');
  });

  it('continues in memory when browser storage is unavailable', () => {
    const unavailable = new BrowserPersistence('http://localhost:3000', 'story', scenario, () => {
      throw new Error('STORAGE_DISABLED');
    });
    expect(() => {
      unavailable.claimRecovery();
      unavailable.saveRecovery(recovery());
      unavailable.write('draft', '文字');
      unavailable.clearReading();
    }).not.toThrow();
    expect(unavailable.read('draft', DraftSchema)).toBeUndefined();
  });

  it('restores displayed and interrupted text without inventing another opening or presentation', () => {
    const saved = storage('conversation');
    saved.write('history', [
      { id: 3, kind: 'user', text: '上一句话', source: 'text' },
      { id: 4, kind: 'speech', text: '被打断的回应', source: 'playback', paused: true },
    ]);
    const view = useConversationDisplay('初次见面的开场', saved);
    expect(view.messages.value).toHaveLength(2);
    expect(view.lastReply.value).toBe('被打断的回应');
    expect(view.replyPaused.value).toBe(true);
    view.addUser('继续聊');
    expect(view.messages.value.at(-1)?.id).toBe(5);
    expect(saved.read('history', ReadingHistorySchema)?.at(-1)?.text).toBe('继续聊');
  });
});
