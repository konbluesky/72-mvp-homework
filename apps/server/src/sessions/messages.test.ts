import { describe, expect, it } from 'vitest';
import type { AudioReadyPayload, Receipt } from '@mira/protocol';
import { SessionManager } from './manager.js';
import { cafeScenario } from '../scenario/cafe/index.js';
import { AppError } from '../http/errors.js';
import { testConfig } from '../../test/helpers.js';

const audio: AudioReadyPayload = {
  segmentId: 'answer',
  text: '你好。',
  audioUrl: '/api/media/answer',
  emotion: 'curious',
  action: 'none',
  events: [],
};
function setup() {
  const manager = new SessionManager(testConfig(), { scenario: cafeScenario });
  const created = manager.create('conversation');
  const session = manager.authenticate(created.sessionId, `Bearer ${created.sessionToken}`);
  const begin = (generation: number, messageId = 'message') =>
    manager.begin(session, {
      generation,
      turnId: `turn-${generation}`,
      messageId,
      receipts: [],
      frozenTurns: [],
    });
  begin(1);
  const turn = manager.startInput(session, 'turn-1', 1, 'input-1', 'request-1', {
    contentDigest: 'original',
  });
  manager.addUser(session, turn, '哈哈');
  const receipt: Receipt = {
    ...turn.identity,
    targetId: audio.segmentId,
    kind: 'segment',
    status: 'presented',
    mode: 'audio',
    receiptId: 'receipt',
  };
  return { manager, session, turn, begin, receipt };
}

describe('message retry and committed history', () => {
  it('retries an unheard failure with fresh execution identities and commits the input only once', () => {
    const h = setup();
    try {
      h.manager.fail(h.turn, new AppError('PROVIDER_FAILED', 502, '服务暂时不可用', true));
      expect(h.session.history).toEqual([]);
      expect(h.manager.snapshot(h.session).messageAttempts[0]).toMatchObject({
        status: 'failed',
        retryable: true,
      });
      h.begin(2);
      const retry = h.manager.startInput(h.session, 'turn-2', 2, 'input-2', 'request-2', {
        contentDigest: 'original',
      });
      h.manager.addUser(h.session, retry, '哈哈');
      h.manager.issue(h.session, retry, audio);
      h.manager.generated(retry);
      expect(h.manager.snapshot(h.session).messageAttempts.at(-1)?.status).toBe('pending');
      const receipt = { ...h.receipt, ...retry.identity };
      h.manager.receipts(h.session, [receipt, receipt]);
      expect(h.session.history).toEqual([
        { role: 'user', text: '哈哈' },
        { role: 'assistant', text: '你好。', mode: 'audio' },
      ]);
      expect(h.manager.snapshot(h.session).messageAttempts.at(-1)).toMatchObject({
        status: 'completed',
        retryable: false,
      });
      h.manager.cancelRequest(h.session, 'turn-1', 1, []);
      expect(retry.abort.signal.aborted).toBe(false);
    } finally {
      h.manager.close();
    }
  });

  it('rejects changed retry content before accepting input', () => {
    const h = setup();
    try {
      h.manager.fail(h.turn, new AppError('PROVIDER_FAILED', 502, '失败', true));
      h.begin(2);
      expect(() =>
        h.manager.startInput(h.session, 'turn-2', 2, 'input-2', 'request-2', {
          contentDigest: 'changed',
        }),
      ).toThrowError('不能改变');
      expect(h.session.current?.input).toBeUndefined();
      expect(h.session.history).toEqual([]);
    } finally {
      h.manager.close();
    }
  });

  it('rejects replay when a frozen snapshot reports an actual partial presentation', () => {
    const h = setup();
    try {
      h.manager.issue(h.session, h.turn, audio);
      h.manager.fail(h.turn, new AppError('STREAM_INTERRUPTED', 499, '断流', true));
      expect(() =>
        h.manager.begin(h.session, {
          generation: 2,
          turnId: 'turn-2',
          messageId: 'message',
          receipts: [],
          frozenTurns: [{ generation: 1, turnId: 'turn-1', receipts: [h.receipt] }],
        }),
      ).toThrowError('实际回应');
      expect(h.session.generation).toBe(1);
      h.manager.cancelRequest(h.session, 'turn-1', 1, [h.receipt]);
      expect(h.manager.snapshot(h.session).messageAttempts[0]).toMatchObject({
        presented: true,
        retryable: false,
      });
      expect(h.session.history).toHaveLength(2);
      expect(() => h.begin(2)).toThrowError('实际回应');
    } finally {
      h.manager.close();
    }
  });

  it('distinguishes a fresh identical utterance from retrying an older message', () => {
    const h = setup();
    try {
      h.manager.fail(h.turn, new AppError('PROVIDER_FAILED', 502, '失败', true));
      h.begin(2, 'new-message');
      const next = h.manager.startInput(h.session, 'turn-2', 2, 'input-2', 'request-2', {
        contentDigest: 'original',
      });
      h.manager.addUser(h.session, next, '哈哈');
      expect(() => h.begin(3)).toThrowError('新的对话');
      expect(h.session.current).toBe(next);
      expect(next.abort.signal.aborted).toBe(false);
    } finally {
      h.manager.close();
    }
  });
});
