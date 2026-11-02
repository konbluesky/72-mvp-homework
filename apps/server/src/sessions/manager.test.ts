import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioReadyPayload, Receipt } from '@mira/protocol';
import { SessionManager } from './manager.js';
import { testConfig } from '../../test/helpers.js';
import { cafeScenario } from '../scenario/cafe/index.js';
import { followTo } from '../scenario/cafe/story.test.helpers.js';
import { AppError } from '../http/errors.js';

function setup(extra: Record<string, string> = {}) {
  const manager = new SessionManager(testConfig(extra), { scenario: cafeScenario });
  const created = manager.create('story');
  const session = manager.authenticate(created.sessionId, `Bearer ${created.sessionToken}`);
  session.narrative = followTo(session.narrative, 'first-counter');
  const frame = cafeScenario.frame(session.narrative);
  session.story = frame.story;
  session.facts = frame.facts;
  manager.begin(session, { generation: 1, turnId: 'turn-1', receipts: [], frozenTurns: [] });
  const turn = manager.startInput(session, 'turn-1', 1, 'input-1', 'digest-1');
  const document = cafeScenario.propose('inspect-menu', session.narrative)[0]!;
  const payload: AudioReadyPayload = {
    segmentId: 'seg-1',
    text: '这里是一张公开的饮品单。',
    emotion: 'relieved',
    action: 'focusProp',
    audioUrl: '/api/media/a1',
    events: [
      { ...document.event, eventId: 'menu-1' },
      { eventId: 'rain-1', type: 'environment', environment: 'rain-soft' },
    ],
  };
  manager.issue(session, turn, payload);
  manager.issueEvents(session, turn, [payload.events[0]!], false, [], document.checkpoint);
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
  it('preserves confirmed progress and history through prolonged inactivity by default', () => {
    vi.useFakeTimers();
    const { manager, session, created, receipt } = setup();
    try {
      manager.receipts(session, [receipt('seg-1'), receipt('menu-1', 'prop')]);
      const before = manager.snapshot(session);
      const checkpoint = session.narrative;
      expect(created.expiresAt).toBeNull();
      vi.advanceTimersByTime(180 * 24 * 60 * 60 * 1000);
      manager.sweep();
      const restored = manager.authenticate(created.sessionId, `Bearer ${created.sessionToken}`);
      expect(restored).toBe(session);
      expect(restored.narrative).toBe(checkpoint);
      expect(manager.snapshot(restored)).toEqual(before);
    } finally {
      manager.close();
    }
  });
  it('restarts an owned session at capacity, cancelling only its old turn', () => {
    const { manager, session, turn, created } = setup({ MAX_SESSIONS: '2' });
    try {
      const other = manager.create('conversation');
      const next = manager.create('story', session);
      expect(manager.sessions.size).toBe(2);
      expect(turn.abort.signal.aborted).toBe(true);
      expect(() =>
        manager.authenticate(created.sessionId, `Bearer ${created.sessionToken}`),
      ).toThrow('这次相遇已结束');
      const fresh = manager.authenticate(next.sessionId, `Bearer ${next.sessionToken}`);
      expect(fresh.generation).toBe(0);
      expect(fresh.history).toEqual([]);
      expect(next.expiresAt).toBeNull();
      manager.begin(fresh, { generation: 1, turnId: 'new-turn', receipts: [], frozenTurns: [] });
      const active = manager.startInput(fresh, 'new-turn', 1, 'new-input', 'new-digest');
      manager.cancelRequest(session, turn.identity.turnId, turn.identity.generation, []);
      expect(active.abort.signal.aborted).toBe(false);
      expect(fresh.current).toBe(active);
      expect(manager.authenticate(other.sessionId, `Bearer ${other.sessionToken}`).id).toBe(
        other.sessionId,
      );
    } finally {
      manager.close();
    }
  });
  it('preserves the old session if preparing its replacement fails', () => {
    const { manager, session, turn, created } = setup({ MAX_SESSIONS: '1' });
    const initial = vi.spyOn(cafeScenario, 'initial').mockImplementationOnce(() => {
      throw new Error('SCENARIO_UNAVAILABLE');
    });
    try {
      expect(() => manager.create('story', session)).toThrow('SCENARIO_UNAVAILABLE');
      expect(manager.sessions.size).toBe(1);
      expect(manager.authenticate(created.sessionId, `Bearer ${created.sessionToken}`)).toBe(
        session,
      );
      expect(turn.abort.signal.aborted).toBe(false);
    } finally {
      initial.mockRestore();
      manager.close();
    }
  });
  it.each(['false', 'true'])('applies input frequency quotas only when enabled (%s)', (enabled) => {
    const { manager, session } = setup({
      RATE_LIMIT_ENABLED: enabled,
      MAX_INPUTS_PER_MINUTE: '1',
    });
    try {
      manager.begin(session, { generation: 2, turnId: 'turn-2', receipts: [], frozenTurns: [] });
      const next = () => manager.startInput(session, 'turn-2', 2, 'input-2', 'digest-2');
      if (enabled === 'true') expect(next).toThrowError('慢一点');
      else {
        expect(next).not.toThrow();
        expect(session.inputTimes).toEqual([]);
      }
    } finally {
      manager.close();
    }
  });
  it('authenticates only the owning token and expires sessions', () => {
    vi.useFakeTimers();
    const { manager, session, created } = setup({ SESSION_TTL_SECONDS: '1' });
    expect(() => manager.authenticate(session.id, 'Bearer wrong')).toThrowError(
      expect.objectContaining({ code: 'UNAUTHORIZED' }),
    );
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
  it('commits sentence/prop/environment independently and preserves deduplication', () => {
    const { manager, session, receipt } = setup();
    const sentence = receipt('seg-1');
    manager.receipts(session, [sentence, sentence]);
    expect(session.story.revealed.includes('menu')).toBe(false);
    expect(session.history).toHaveLength(1);
    manager.receipts(session, [receipt('rain-1', 'environment')]);
    expect(session.facts).toEqual({ rain_softened: false });
    manager.receipts(session, [receipt('menu-1', 'prop'), receipt('rain-1', 'environment')]);
    expect(session.facts).toEqual({ rain_softened: false });
    expect(session.story.revealed).toContain('menu');
    manager.close();
  });
  it('merges frozen presented receipts before a rapid next turn context', () => {
    const { manager, session, receipt } = setup();
    const photo = receipt('menu-1', 'prop');
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
    expect(session.story.revealed.includes('menu')).toBe(true);
    expect(session.generation).toBe(3);
    manager.close();
  });
  it('rejects late success after an explicit cancel snapshot', () => {
    const { manager, session, receipt } = setup();
    manager.cancelRequest(session, 'turn-1', 1, [receipt('seg-1')]);
    expect(() => manager.receipts(session, [receipt('menu-1', 'prop')])).toThrowError('不能追加');
    expect(() =>
      manager.cancelRequest(session, 'turn-1', 1, [receipt('menu-1', 'prop')]),
    ).toThrowError('不能追加');
    expect(session.story.revealed.includes('menu')).toBe(false);
    manager.close();
  });
  it('accepts the first explicit frozen snapshot after disconnect, but never a later expansion', () => {
    const { manager, session, turn, receipt } = setup();
    manager.fail(turn, new AppError('STREAM_INTERRUPTED', 499, '断流'));
    const photo = receipt('menu-1', 'prop');
    expect(() => manager.receipts(session, [photo])).toThrowError('不能追加');
    manager.begin(session, {
      generation: 2,
      turnId: 'turn-2',
      receipts: [photo],
      frozenTurns: [{ generation: 1, turnId: 'turn-1', receipts: [photo] }],
    });
    expect(session.story.revealed.includes('menu')).toBe(true);
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
      manager.cancelRequest(session, 'turn-2', 2, [receipt('menu-1', 'prop')]),
    ).toThrow();
    expect(session.story.revealed.includes('menu')).toBe(false);
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
    manager.receipts(session, [receipt('menu-1', 'prop', 'failed')]);
    expect(session.story.revealed.includes('menu')).toBe(false);
    expect(() =>
      manager.receipts(session, [{ ...receipt('menu-1', 'prop'), targetId: 'invented' }]),
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
