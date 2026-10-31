import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioReadyPayload, Receipt } from '@mira/protocol';
import { SessionManager } from './manager.js';
import { testConfig } from '../../test/helpers.js';
import { AppError } from '../http/errors.js';

function setup(extra: Record<string, string> = {}) {
  const manager = new SessionManager(testConfig(extra));
  const created = manager.create();
  const session = manager.authenticate(created.sessionId, `Bearer ${created.sessionToken}`);
  manager.begin(session, { generation: 1, turnId: 'turn-1', receipts: [], frozenTurns: [] });
  const turn = manager.startInput(session, 'turn-1', 1, 'input-1', 'digest-1');
  const payload: AudioReadyPayload = {
    segmentId: 'seg-1',
    text: '这张照片，是我旅行时留下的。',
    emotion: 'relieved',
    action: 'offerPhoto',
    audioUrl: '/api/media/a1',
    events: [
      { eventId: 'photo-1', type: 'photo', resourceId: 'travel_photo_01' },
      { eventId: 'rain-1', type: 'environment', environment: 'rain-soft' },
    ],
  };
  manager.issue(session, turn, payload);
  manager.firstAudioPublished(turn);
  const receipt = (
    targetId: string,
    kind: Receipt['kind'] = 'segment',
    status: Receipt['status'] = 'presented',
  ): Receipt => ({
    ...turn.identity,
    receiptId: `receipt-${targetId}-${status}`,
    targetId,
    kind,
    status,
    ...(kind === 'segment' ? { mode: 'audio' as const } : {}),
  });
  return { manager, session, turn, receipt, created };
}
afterEach(() => vi.useRealTimers());

describe('single owner and presented facts', () => {
  it('authenticates only the owning token and expires sessions', () => {
    vi.useFakeTimers();
    const { manager, session, created } = setup({ SESSION_TTL_SECONDS: '1' });
    expect(() => manager.authenticate(session.id, 'Bearer wrong')).toThrowError('请重新进入');
    vi.advanceTimersByTime(1001);
    expect(() => manager.authenticate(session.id, `Bearer ${created.sessionToken}`)).toThrowError(
      '这次相遇已结束',
    );
    expect(manager.sessions.size).toBe(0);
  });
  it('rejects generation conflicts, stale begin and old cancellation without touching new ownership', () => {
    const { manager, session, turn } = setup();
    expect(() =>
      manager.begin(session, { generation: 1, turnId: 'other', receipts: [], frozenTurns: [] }),
    ).toThrowError('冲突');
    manager.begin(session, { generation: 2, turnId: 'turn-2', receipts: [], frozenTurns: [] });
    const current = manager.startInput(session, 'turn-2', 2, 'input-2', 'digest-2');
    manager.cancelRequest(session, 'turn-1', 1, []);
    expect(turn.abort.signal.aborted).toBe(true);
    expect(current.abort.signal.aborted).toBe(false);
    expect(() =>
      manager.begin(session, { generation: 1, turnId: 'turn-1', receipts: [], frozenTurns: [] }),
    ).toThrowError('旧的');
    manager.close();
  });
  it('rejects duplicate input without recharging and distinguishes changed input/completion', () => {
    const { manager, session, turn } = setup();
    expect(() => manager.startInput(session, 'turn-1', 1, 'input-1', 'digest-1')).toThrowError(
      '正在回应',
    );
    expect(() => manager.startInput(session, 'turn-1', 1, 'input-1', 'changed')).toThrowError(
      '不能改变',
    );
    manager.generated(turn);
    expect(() => manager.startInput(session, 'turn-1', 1, 'input-1', 'digest-1')).toThrowError(
      '不会重复播放',
    );
    manager.close();
  });
  it('commits sentence/photo/environment independently and preserves deduplication', () => {
    const { manager, session, receipt } = setup();
    const sentence = receipt('seg-1');
    manager.receipts(session, [sentence, sentence]);
    expect(session.facts.photo_revealed).toBe(false);
    expect(session.history).toHaveLength(1);
    expect(() => manager.receipts(session, [receipt('rain-1', 'environment')])).toThrowError(
      '照片尚未呈现',
    );
    manager.receipts(session, [receipt('photo-1', 'photo'), receipt('rain-1', 'environment')]);
    expect(session.facts).toEqual({ photo_revealed: true, rain_softened: true });
    manager.close();
  });
  it('merges frozen presented receipts before a rapid next turn context', () => {
    const { manager, session, receipt } = setup();
    const photo = receipt('photo-1', 'photo');
    manager.begin(session, {
      generation: 2,
      turnId: 'turn-2',
      receipts: [photo],
      frozenTurns: [{ generation: 1, turnId: 'turn-1', receipts: [photo] }],
    });
    manager.begin(session, {
      generation: 3,
      turnId: 'turn-3',
      receipts: [photo],
      frozenTurns: [{ generation: 2, turnId: 'turn-2', receipts: [] }],
    });
    expect(session.facts.photo_revealed).toBe(true);
    expect(session.generation).toBe(3);
    manager.close();
  });
  it('rejects late success after an explicit cancel snapshot', () => {
    const { manager, session, receipt } = setup();
    manager.cancelRequest(session, 'turn-1', 1, [receipt('seg-1')]);
    expect(() => manager.receipts(session, [receipt('photo-1', 'photo')])).toThrowError('不能追加');
    expect(() =>
      manager.cancelRequest(session, 'turn-1', 1, [receipt('photo-1', 'photo')]),
    ).toThrowError('不能追加');
    expect(session.facts.photo_revealed).toBe(false);
    manager.close();
  });
  it('accepts the first explicit frozen snapshot after disconnect, but never a later expansion', () => {
    const { manager, session, turn, receipt } = setup();
    manager.fail(turn, new AppError('STREAM_INTERRUPTED', 499, '断流'));
    const photo = receipt('photo-1', 'photo');
    expect(() => manager.receipts(session, [photo])).toThrowError('不能追加');
    manager.begin(session, {
      generation: 2,
      turnId: 'turn-2',
      receipts: [photo],
      frozenTurns: [{ generation: 1, turnId: 'turn-1', receipts: [photo] }],
    });
    expect(session.facts.photo_revealed).toBe(true);
    expect(() =>
      manager.cancelRequest(session, 'turn-1', 1, [receipt('rain-1', 'environment')]),
    ).toThrowError('不能追加');
    manager.close();
  });
  it('ignores an empty local intent snapshot whose begin never reached the server', () => {
    const { manager, session } = setup();
    expect(() =>
      manager.begin(session, {
        generation: 3,
        turnId: 'turn-3',
        receipts: [],
        frozenTurns: [{ generation: 2, turnId: 'never-arrived', receipts: [] }],
      }),
    ).not.toThrow();
    expect(session.generation).toBe(3);
    manager.close();
  });
  it('rejects mixed-turn cancellation atomically before committing any receipt', () => {
    const { manager, session, receipt } = setup();
    manager.begin(session, { generation: 2, turnId: 'turn-2', receipts: [], frozenTurns: [] });
    expect(() =>
      manager.cancelRequest(session, 'turn-2', 2, [receipt('photo-1', 'photo')]),
    ).toThrow();
    expect(session.facts.photo_revealed).toBe(false);
    manager.close();
  });
  it('releases the first audio deadline independently and retains a whole-turn bound', () => {
    vi.useFakeTimers();
    const { manager, turn } = setup({
      FIRST_AUDIO_TIMEOUT_MS: '100',
      TURN_MAX_LIFETIME_MS: '1000',
    });
    expect(manager.remainingLifetime(turn)).toBe(1000);
    vi.advanceTimersByTime(101);
    expect(manager.remainingLifetime(turn)).toBe(899);
    expect(turn.abort.signal.aborted).toBe(false);
    vi.advanceTimersByTime(900);
    expect(turn.abort.signal.aborted).toBe(true);
    expect(turn.failure?.code).toBe('TURN_TIMEOUT');
    manager.close();
  });
  it('does not let failed or invented receipts commit facts', () => {
    const { manager, session, receipt } = setup();
    manager.receipts(session, [receipt('photo-1', 'photo', 'failed')]);
    expect(session.facts.photo_revealed).toBe(false);
    expect(() =>
      manager.receipts(session, [{ ...receipt('photo-1', 'photo'), targetId: 'invented' }]),
    ).toThrow();
    manager.close();
  });
});

it('checks receipt capacity against the entire new batch before committing any of it', () => {
  const { manager, session, receipt } = setup();
  const batch = Array.from({ length: 65 }, (_, index) => ({
    ...receipt('seg-1'),
    receiptId: `bulk-${index}`,
  }));
  expect(() => manager.receipts(session, batch)).toThrowError('记录已满');
  expect(session.history).toHaveLength(0);
  manager.close();
});
