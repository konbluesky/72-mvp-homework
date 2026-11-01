// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialStory, type Receipt } from '@mira/protocol';
import { ApiClient } from '../api/client.js';
import { BrowserPersistence, DraftSchema, type ActiveRecovery } from '../persistence/browser.js';
import { PlaybackScheduler } from '../playback/scheduler.js';
import { initialInteractiveState } from './state.js';
import { TurnController } from './turn-controller.js';

const scenario = { id: 'sample-story', version: '1' };
const origin = 'http://localhost:3000';
const json = (value: unknown) => new Response(JSON.stringify(value));
const session = () => ({
  sessionId: 'session',
  sessionToken: 'x'.repeat(40),
  expiresAt: Date.now() + 60000,
  mode: 'mock' as const,
  capabilities: { voiceInput: true },
  scene: { character: 'guide', scenario, environment: 'rain', facts: {}, story: initialStory() },
});
const snapshot = (generation = 0, revision = 0) => ({
  sessionId: 'session',
  generation,
  capabilities: { voiceInput: true },
  scene: { ...session().scene, story: { ...initialStory(), revision } },
  history: [],
});
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
function save(value: ActiveRecovery, entry: 'story' | 'conversation' = 'story') {
  const storage = new BrowserPersistence(origin, entry, scenario);
  storage.claimRecovery();
  storage.saveRecovery(value);
  return storage;
}
function harness(
  responder?: (path: string, body: unknown) => Response | Promise<Response> | undefined,
  entry: 'story' | 'conversation' = 'story',
) {
  const requests: Array<{ path: string; body: unknown }> = [];
  const api = new ApiClient(
    origin,
    async (input, init) => {
      const path = new URL(String(input)).pathname;
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      requests.push({ path, body });
      const response = responder?.(path, body);
      if (response) return response;
      if (path === '/api/sessions') return json(session());
      if (path.endsWith('/cancel')) return json({ status: 'cancelled' });
      if (path === '/api/sessions/session') return json(snapshot());
      throw new Error('UNEXPECTED_REQUEST');
    },
    entry,
    scenario,
  );
  const state = initialInteractiveState();
  const playback = new PlaybackScheduler({
    audio: {
      unlock: async () => {},
      prepare: async () => ({ start: () => () => {} }),
      dispose: async () => {},
    },
    presentation: { photo: async () => {}, environment: async () => {}, clear() {} },
    view: (value) => Object.assign(state, value),
    receipt() {},
    failure() {},
  });
  const controller = new TurnController(api, playback, state);
  return { api, controller, requests, state };
}
beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

describe.each(['story', 'conversation'] as const)(
  '%s connection failure classification',
  (entry) => {
    it('restores a non-expiring session after months without creating a new one', async () => {
      vi.useFakeTimers();
      const saved = recovery();
      saved.session.expiresAt = null;
      const old = save(saved, entry);
      old.write('draft', '下次回来继续');
      vi.setSystemTime(Date.now() + 180 * 24 * 60 * 60 * 1000);
      const h = harness(
        (path) => (path === '/api/sessions/session' ? json(snapshot(2, 7)) : undefined),
        entry,
      );
      await h.controller.connect();
      expect(h.state.connected).toBe(true);
      expect(h.state.sessionExpired).toBe(false);
      expect(h.state.story.revision).toBe(7);
      expect(h.api.persistence?.read('draft', DraftSchema)).toBe('下次回来继续');
      const restored = h.api.persistence?.claimRecovery();
      expect(restored?.status === 'active' && restored.session.expiresAt).toBeNull();
      expect(h.requests.map((request) => request.path)).toEqual(['/api/sessions/session']);
      await h.controller.dispose();
    });
    it('retries the same explicit replacement after a network failure during restart', async () => {
      const saved = recovery();
      saved.session.expiresAt = null;
      save(saved, entry);
      let creates = 0;
      const h = harness((path) => {
        if (path !== '/api/sessions') return undefined;
        if (++creates === 1) return Promise.reject(new TypeError('Failed to fetch'));
        return json({ ...session(), sessionId: 'new-session', expiresAt: null });
      }, entry);
      await h.controller.connect();
      await h.controller.connect(true);
      expect(h.state.sessionExpired).toBe(false);
      expect(h.state.connected).toBe(false);
      await h.controller.connect();
      expect(h.state.connected).toBe(true);
      const replacements = h.requests.filter((request) => request.path === '/api/sessions');
      expect(replacements.map((request) => request.body)).toEqual([
        { entry, replaceSessionId: 'session' },
        { entry, replaceSessionId: 'session' },
      ]);
      await h.controller.dispose();
    });
    it('continues a requested restart after reloading during a network failure', async () => {
      const saved = recovery();
      saved.session.expiresAt = null;
      save(saved, entry);
      const first = harness(
        (path) =>
          path === '/api/sessions' ? Promise.reject(new TypeError('Failed to fetch')) : undefined,
        entry,
      );
      await first.controller.connect();
      await first.controller.connect(true);
      const pending = first.api.persistence?.claimRecovery();
      expect(pending?.status === 'active' && pending.pendingRestart).toBe(true);
      await first.controller.dispose();
      const reopened = harness(
        (path) =>
          path === '/api/sessions'
            ? json({ ...session(), sessionId: 'new-session', expiresAt: null })
            : undefined,
        entry,
      );
      await reopened.controller.connect();
      expect(reopened.state.connected).toBe(true);
      expect(reopened.state.sessionExpired).toBe(false);
      expect(reopened.requests).toEqual([
        { path: '/api/sessions', body: { entry, replaceSessionId: 'session' } },
      ]);
      await reopened.controller.dispose();
    });
    it.each(['offline', 'bad-gateway', 'unavailable'] as const)(
      'keeps the same session, draft and progress recoverable after %s',
      async (failure) => {
        const old = save(recovery(), entry);
        old.write('draft', '网络恢复后继续说');
        let failing = true;
        const h = harness((path) => {
          if (path !== '/api/sessions/session') return undefined;
          if (!failing) return json(snapshot(2, 7));
          if (failure === 'offline') return Promise.reject(new TypeError('Failed to fetch'));
          return new Response('Temporary proxy failure', {
            status: failure === 'bad-gateway' ? 502 : 503,
          });
        }, entry);
        await h.controller.connect();
        expect(h.state.connected).toBe(false);
        expect(h.state.sessionExpired).toBe(false);
        const saved = h.api.persistence?.claimRecovery();
        expect(saved?.status === 'active' && saved.session.sessionId).toBe('session');
        expect(h.api.persistence?.read('draft', DraftSchema)).toBe('网络恢复后继续说');
        failing = false;
        await h.controller.connect();
        expect(h.state.connected).toBe(true);
        expect(h.state.sessionExpired).toBe(false);
        expect(h.state.story.revision).toBe(7);
        expect(h.requests.map((request) => request.path)).toEqual([
          '/api/sessions/session',
          '/api/sessions/session',
        ]);
        await h.controller.dispose();
      },
    );

    it('keeps a control-request timeout recoverable without expiring the session', async () => {
      vi.useFakeTimers();
      save(recovery(), entry);
      const h = harness(
        (path) => (path === '/api/sessions/session' ? new Promise<Response>(() => {}) : undefined),
        entry,
      );
      const connecting = h.controller.connect();
      await vi.advanceTimersByTimeAsync(10001);
      await connecting;
      expect(h.state.connected).toBe(false);
      expect(h.state.sessionExpired).toBe(false);
      expect(h.state.failure).toContain('请求超时');
      expect(h.api.persistence?.claimRecovery()?.status).toBe('active');
      expect(h.requests.map((request) => request.path)).toEqual(['/api/sessions/session']);
      await h.controller.dispose();
    });

    it('ignores a late session-expired response from a superseded connection', async () => {
      save(recovery(), entry);
      let complete!: (response: Response) => void;
      let snapshots = 0;
      const h = harness((path) => {
        if (path !== '/api/sessions/session') return undefined;
        if (++snapshots === 1)
          return new Promise<Response>((resolve) => {
            complete = resolve;
          });
        return json(snapshot(2, 7));
      }, entry);
      const older = h.controller.connect();
      h.controller.pauseRecovery();
      await h.controller.connect();
      complete(
        new Response(
          JSON.stringify({
            error: { code: 'SESSION_EXPIRED', message: '旧会话已过期', retryable: true },
            requestId: 'old',
          }),
          { status: 410 },
        ),
      );
      await older;
      expect(h.state.connected).toBe(true);
      expect(h.state.sessionExpired).toBe(false);
      expect(h.state.story.revision).toBe(7);
      expect(h.api.persistence?.claimRecovery()?.status).toBe('active');
      expect(h.requests.every((request) => request.path === '/api/sessions/session')).toBe(true);
      await h.controller.dispose();
    });
  },
);

describe('reload recovery ownership', () => {
  it('never replays a visibly started response even if its final receipt was not committed', async () => {
    const turn = { sessionId: 'session', generation: 1, turnId: 'attempt' };
    save({
      ...recovery(),
      generation: 1,
      activeTurn: { generation: 1, turnId: 'attempt', receipts: [] },
      outgoing: [
        {
          messageId: 'message',
          turn,
          input: { text: '哈哈' },
          status: 'responding',
          started: true,
          presented: false,
          retryable: false,
          error: '',
        },
      ],
    });
    const next = harness((path) =>
      path === '/api/sessions/session'
        ? json({
            ...snapshot(1),
            messageAttempts: [
              {
                ...turn,
                messageId: 'message',
                status: 'interrupted',
                presented: false,
                retryable: true,
                error: '',
              },
            ],
          })
        : undefined,
    );
    await next.controller.connect();
    expect(next.state.outgoing[0]).toMatchObject({ status: 'interrupted', retryable: false });
    await next.controller.retry('message');
    expect(next.requests.some((request) => request.path.endsWith('/input'))).toBe(false);
    await next.controller.dispose();
  });

  it('restores a failed message identity without replaying input and permits explicit retry', async () => {
    const turn = { sessionId: 'session', generation: 1, turnId: 'attempt' };
    save({
      ...recovery(),
      generation: 1,
      activeTurn: { generation: 1, turnId: 'attempt', receipts: [] },
      outgoing: [
        {
          messageId: 'message',
          turn,
          input: { text: '哈哈' },
          status: 'waiting',
          started: false,
          presented: false,
          retryable: false,
          error: '',
        },
      ],
    });
    const next = harness((path) =>
      path === '/api/sessions/session'
        ? json({
            ...snapshot(1),
            messageAttempts: [
              {
                ...turn,
                messageId: 'message',
                status: 'interrupted',
                presented: false,
                retryable: true,
                error: '',
              },
            ],
          })
        : undefined,
    );
    await next.controller.connect();
    expect(next.state.outgoing).toHaveLength(1);
    expect(next.state.outgoing[0]).toMatchObject({
      messageId: 'message',
      status: 'failed',
      retryable: true,
    });
    expect(next.controller.canRetry('message')).toBe(true);
    expect(next.requests.some((request) => request.path.endsWith('/input'))).toBe(false);
    await next.controller.dispose();
  });

  it('reuses an unexpired session without posting another session or replaying input', async () => {
    const first = harness();
    await first.controller.connect();
    first.api.persistence?.write('draft', '还没确认的文字');
    await first.controller.dispose();
    const next = harness();
    await next.controller.connect();
    expect(next.state.connected).toBe(true);
    expect(next.requests.map((request) => request.path)).toEqual(['/api/sessions/session']);
    expect(next.api.persistence?.read('draft', DraftSchema)).toBe('还没确认的文字');
    await next.controller.dispose();
  });

  it('freezes only stored actual presentations before reading the authoritative snapshot', async () => {
    const receipt: Receipt = {
      sessionId: 'session',
      generation: 3,
      turnId: 'old',
      receiptId: 'seen',
      targetId: 'photo',
      kind: 'photo',
      status: 'presented',
    };
    save({
      ...recovery(),
      generation: 3,
      pending: [receipt],
      activeTurn: { generation: 3, turnId: 'old', receipts: [receipt] },
    });
    const next = harness((path) =>
      path === '/api/sessions/session' ? json(snapshot(3, 7)) : undefined,
    );
    await next.controller.connect();
    expect(next.requests.map((request) => request.path)).toEqual([
      '/api/sessions/session/turns/old/cancel',
      '/api/sessions/session',
    ]);
    expect(next.requests[0]?.body).toEqual({ generation: 3, receipts: [receipt], frozen: true });
    expect(next.state.story.revision).toBe(7);
    const saved = next.api.persistence?.claimRecovery();
    expect(saved?.status === 'active' && saved.pending).toEqual([]);
    await next.controller.dispose();
  });

  it('keeps expiry across reloads and requires an explicit restart while retaining drafts', async () => {
    const old = save({
      ...recovery(),
      session: { ...recovery().session, expiresAt: Date.now() - 1 },
    });
    old.write('draft', '保留我');
    const first = harness();
    await first.controller.connect();
    expect(first.state.sessionExpired).toBe(true);
    expect(first.requests).toHaveLength(0);
    await first.controller.dispose();
    const next = harness();
    await next.controller.connect();
    expect(next.state.sessionExpired).toBe(true);
    await next.controller.recoverConnection(true);
    expect(next.requests).toHaveLength(0);
    expect(next.api.persistence?.read('draft', DraftSchema)).toBe('保留我');
    await next.controller.connect(true);
    expect(next.state.connected).toBe(true);
    expect(next.requests.map((request) => request.path)).toEqual(['/api/sessions']);
    await next.controller.dispose();
  });

  it('retains a valid frozen recovery record when an interrupted turn cannot be cancelled online', async () => {
    const first = harness((path) => {
      if (path.endsWith('/turns')) return new Promise<Response>(() => {});
      if (path.endsWith('/cancel')) return Promise.reject(new Error('NETWORK_LOST'));
      return undefined;
    });
    await first.controller.connect();
    first.controller.send('不要在刷新后自动重发');
    first.controller.interrupt();
    const stored = first.api.persistence?.claimRecovery();
    expect(stored?.status).toBe('active');
    expect(stored?.status === 'active' && stored.activeTurn).toMatchObject({
      generation: 1,
      receipts: [],
    });
    await first.controller.dispose();
    const next = harness((path) =>
      path === '/api/sessions/session' ? json(snapshot(1)) : undefined,
    );
    await next.controller.connect();
    expect(next.state.connected).toBe(true);
    expect(next.requests.some((request) => request.path.endsWith('/input'))).toBe(false);
    await next.controller.dispose();
  });

  it('does not recreate a server-lost session or erase local reading', async () => {
    const old = save(recovery());
    old.write('draft', '服务重启后仍保留');
    const next = harness((path) =>
      path === '/api/sessions/session'
        ? new Response(
            JSON.stringify({
              error: { code: 'SESSION_EXPIRED', message: '会话已失效', retryable: true },
              requestId: 'r',
            }),
            { status: 410 },
          )
        : undefined,
    );
    await next.controller.connect();
    await next.controller.recoverConnection(true);
    expect(next.state.sessionExpired).toBe(true);
    expect(next.requests).toHaveLength(1);
    expect(next.api.persistence?.read('draft', DraftSchema)).toBe('服务重启后仍保留');
    await next.controller.dispose();
  });

  it('cannot let a delayed old snapshot overwrite a newly created session or its browser record', async () => {
    save(recovery());
    let finish!: (value: Response) => void;
    const next = harness((path) =>
      path === '/api/sessions/session'
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : path === '/api/sessions'
          ? json({ ...session(), sessionId: 'new-session' })
          : undefined,
    );
    const older = next.controller.connect();
    await next.controller.connect(true);
    finish(json(snapshot(50, 50)));
    await older;
    expect(next.state.story.revision).toBe(0);
    const saved = next.api.persistence?.claimRecovery();
    expect(saved?.status === 'active' && saved.session.sessionId).toBe('new-session');
    await next.controller.dispose();
  });

  it('discards cached suggestions if the server has advanced the story', async () => {
    save({
      ...recovery(),
      generation: 1,
      presentation: {
        revision: 2,
        opening: null,
        suggestions: [{ label: '旧选项', draft: '旧发言' }],
      },
    });
    const next = harness((path) =>
      path === '/api/sessions/session' ? json(snapshot(2, 3)) : undefined,
    );
    await next.controller.connect();
    expect(next.state.suggestions).toEqual([]);
    await next.controller.dispose();
  });

  it('restores completed reply suggestions only against the same server generation and revision', async () => {
    const suggestions = [{ label: '继续', draft: '我们继续聊聊' }];
    save({
      ...recovery(),
      generation: 1,
      presentation: { revision: 2, opening: null, suggestions },
    });
    const next = harness((path) =>
      path === '/api/sessions/session' ? json(snapshot(1, 2)) : undefined,
    );
    await next.controller.connect();
    expect(next.state.suggestions).toEqual(suggestions);
    expect(next.requests.some((request) => request.path.endsWith('/input'))).toBe(false);
    await next.controller.dispose();
  });
});
