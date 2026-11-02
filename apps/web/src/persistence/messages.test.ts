// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { BrowserPersistence, type ActiveRecovery } from './browser.js';
import { IndexedMessageDatabase, type MessageStorageStatus } from './messages.js';
import { useConversationDisplay } from '../app/conversation-display.js';
import { MemoryMessageDatabase, legacyRecordKey } from '../../test/message-database.js';

const origin = 'http://localhost:3000';
const scenario = { id: 'sample-story', version: '1' };
const historyKey = legacyRecordKey(origin, 'conversation', scenario.id, 'history');
const sessionKey = legacyRecordKey(origin, 'conversation', scenario.id, 'session');
const history = [{ id: 1, kind: 'user' as const, text: '迁移前的发言', paused: false }];
const outgoing = [
  {
    messageId: 'message',
    turn: { sessionId: 'session', generation: 1, turnId: 'turn' },
    input: { text: '迁移前的发言' },
    status: 'failed' as const,
    started: false,
    presented: false,
    retryable: true,
    error: '暂时失败',
  },
];
const recovery: ActiveRecovery = {
  status: 'active',
  session: { sessionId: 'session', sessionToken: 'x'.repeat(40), expiresAt: null, mode: 'mock' },
  scenarioVersion: '1',
  generation: 1,
  pending: [],
  frozenTurns: [],
  outgoing,
};
let database: MemoryMessageDatabase;
const store = () => new BrowserPersistence(origin, 'conversation', scenario, undefined, database);
function legacy() {
  localStorage.setItem(historyKey, JSON.stringify(history));
  localStorage.setItem(
    sessionKey,
    JSON.stringify({ version: 1, owner: 'previous-page', value: recovery }),
  );
}
beforeEach(() => {
  localStorage.clear();
  database = new MemoryMessageDatabase();
});

describe('asynchronous message persistence', () => {
  it('moves history and outgoing text together, then removes only committed legacy sources', async () => {
    legacy();
    const first = store();
    expect(await first.loadMessages()).toEqual({ history, outgoing });
    expect(localStorage.getItem(historyKey)).toBeNull();
    expect(JSON.parse(localStorage.getItem(sessionKey)!).value.outgoing).toBeUndefined();
    expect(JSON.parse(localStorage.getItem(sessionKey)!).value.session.sessionToken).toBe(
      recovery.session.sessionToken,
    );
    expect(await store().loadMessages()).toEqual({ history, outgoing });
  });

  it('retains legacy data after an aborted commit, surfaces the error, and recovers on a later write', async () => {
    legacy();
    database.failCommit = true;
    const first = store();
    const statuses: MessageStorageStatus[] = [];
    first.onMessageStatus((status) => statuses.push(status));
    expect(await first.loadMessages()).toEqual({ history, outgoing });
    expect(localStorage.getItem(historyKey)).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(sessionKey)!).value.outgoing).toEqual(outgoing);
    expect(statuses.at(-1)?.error).not.toBe('');
    const next = [
      ...history,
      { id: 2, kind: 'speech' as const, text: '重试保存后的回应', paused: false },
    ];
    await first.saveHistory(next);
    expect((await first.loadMessages()).outgoing).toEqual(outgoing);
    expect(localStorage.getItem(historyKey)).toBeNull();
    expect(JSON.parse(localStorage.getItem(sessionKey)!).value.outgoing).toBeUndefined();
    expect(statuses.at(-1)?.error).toBe('');
    expect((await store().loadMessages()).history).toEqual(next);
  });
  it('does not delete a legacy source changed by another writer while migration was pending', async () => {
    legacy();
    const first = store();
    const delayed = database.holdNext();
    const loading = first.loadMessages();
    await delayed.started;
    const newer = [{ ...outgoing[0]!, input: { text: '迁移期间刚写入的发言' } }];
    const source = JSON.parse(localStorage.getItem(sessionKey)!);
    source.value.outgoing = newer;
    localStorage.setItem(sessionKey, JSON.stringify(source));
    delayed.release();
    await loading;
    first.saveRecovery(recovery);
    await first.flushMessages();
    await store().loadMessages();
    expect(JSON.parse(localStorage.getItem(sessionKey)!).value.outgoing).toEqual(newer);
  });

  it('can migrate even when changing the legacy ownership marker initially exceeds localStorage quota', async () => {
    legacy();
    let full = true;
    const limited: Storage = {
      get length() {
        return localStorage.length;
      },
      getItem: (key) => localStorage.getItem(key),
      key: (index) => localStorage.key(index),
      clear: () => localStorage.clear(),
      setItem: (key, value) => {
        if (full) throw new Error('QuotaExceededError');
        localStorage.setItem(key, value);
      },
      removeItem: (key) => {
        localStorage.removeItem(key);
        full = false;
      },
    };
    const first = new BrowserPersistence(origin, 'conversation', scenario, () => limited, database);
    expect(await first.loadMessages()).toEqual({ history, outgoing });
    expect(localStorage.getItem(historyKey)).toBeNull();
    expect(await first.loadMessages()).toEqual({ history, outgoing });
  });

  it('does not let a late initial read resurrect history after restart', async () => {
    legacy();
    const first = store();
    const delayed = database.holdNext();
    const view = useConversationDisplay('新的开场', first);
    await delayed.started;
    const clearing = first.clearReading();
    view.reset();
    delayed.release();
    await Promise.all([view.ready, clearing]);
    await first.flushMessages();
    expect(view.messages.value.map((line) => line.text)).toEqual(['新的开场']);
    expect((await store().loadMessages()).history.map((line) => line.text)).toEqual(['新的开场']);
  });

  it('does not apply a deferred read after its display was disposed', async () => {
    legacy();
    const first = store();
    const delayed = database.holdNext();
    const view = useConversationDisplay('开场', first);
    await delayed.started;
    view.dispose();
    delayed.release();
    await view.ready;
    expect(view.messages.value).toEqual([]);
    expect((await store().loadMessages()).history).toEqual(history);
  });

  it('orders queued writes and clears so an old write cannot follow the new conversation', async () => {
    const first = store();
    await first.loadMessages();
    const delayed = database.holdNext();
    const older = first.saveHistory(history);
    await delayed.started;
    const clearing = first.clearReading();
    const next = [{ id: 2, kind: 'user' as const, text: '新会话发言' }];
    const newer = first.saveHistory(next);
    delayed.release();
    await Promise.all([older, clearing, newer]);
    expect((await store().loadMessages()).history.map((line) => line.text)).toEqual(['新会话发言']);
  });

  it('merges reading and outgoing updates without overwriting the other field', async () => {
    const first = store();
    await first.loadMessages();
    first.saveRecovery(recovery);
    const saving = first.saveHistory(history);
    await saving;
    await first.flushMessages();
    expect(await store().loadMessages()).toEqual({ history, outgoing });
    expect(JSON.parse(localStorage.getItem(sessionKey)!).value.outgoing).toBeUndefined();
  });

  it('keeps a failed clear from resurrecting old records on the next reload', async () => {
    legacy();
    const first = store();
    await first.loadMessages();
    database.failCommit = true;
    await first.clearReading();
    const reopened = store();
    expect(await reopened.loadMessages()).toEqual({ history: [], outgoing: [] });
  });
  it('finishes a previously failed clear before saving messages from the new conversation', async () => {
    legacy();
    const first = store();
    await first.loadMessages();
    database.failCommit = true;
    await first.clearReading();
    await first.saveHistory([{ id: 2, kind: 'user', text: '重新开始后的发言' }]);
    expect((await store().loadMessages()).history.map((line) => line.text)).toEqual([
      '重新开始后的发言',
    ]);
  });

  it('retries all unsaved fields together when the next write changes a different field', async () => {
    legacy();
    const first = store();
    await first.loadMessages();
    const next = [{ id: 2, kind: 'user' as const, text: '还没保存成功的新发言' }];
    database.failCommit = true;
    await first.saveHistory(next);
    first.saveRecovery(recovery);
    await first.flushMessages();
    expect((await store().loadMessages()).history.map((line) => line.text)).toEqual([
      '还没保存成功的新发言',
    ]);
  });

  it('rejects delayed writes after another page takes ownership and clears the conversation', async () => {
    const older = store();
    older.claimRecovery();
    older.saveRecovery(recovery);
    await older.loadMessages();
    const delayed = database.holdNext();
    const writing = older.saveHistory(history);
    await delayed.started;
    const newer = store();
    const clearing = newer.clearReading();
    delayed.release();
    await Promise.all([writing, clearing]);
    await older.saveHistory(history);
    expect((await newer.loadMessages()).history).toEqual([]);
  });

  it('keeps the application usable without silently writing new messages back to localStorage', async () => {
    legacy();
    const unavailable = new IndexedMessageDatabase(() => {
      throw new Error('INDEXEDDB_DISABLED');
    });
    const first = new BrowserPersistence(origin, 'conversation', scenario, undefined, unavailable);
    const statuses: MessageStorageStatus[] = [];
    first.onMessageStatus((status) => statuses.push(status));
    await first.loadMessages();
    await first.saveHistory([{ id: 9, kind: 'user', text: '仅当前页面的新发言' }]);
    expect(JSON.parse(localStorage.getItem(historyKey)!)).toEqual(history);
    expect(statuses.at(-1)?.loading).toBe(false);
    expect(statuses.at(-1)?.error).not.toBe('');
  });
});
