// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ApiClient } from '../api/client.js';
import { PlaybackScheduler } from '../playback/scheduler.js';
import { useSceneStore } from '../stores/scene.js';
import { TurnController } from './turn-controller.js';
import * as recording from './recorder.js';
import {
  BeginTurnSchema,
  TextInputSchema,
  type ServerEvent,
  type TurnIdentity,
} from '@mira/protocol';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const begunResponse = (body: unknown) => {
  const { generation, turnId } = BeginTurnSchema.parse(body);
  return json({ sessionId: 'session', generation, turnId, status: 'begun', acknowledged: [] });
};
const session = {
  sessionId: 'session',
  sessionToken: 'x'.repeat(40),
  expiresAt: Date.now() + 60_000,
  mode: 'mock',
  capabilities: { voiceInput: true },
  scene: {
    character: 'mira',
    environment: 'rain',
    facts: { photo_revealed: false, rain_softened: false },
  },
};
const event = (turn: TurnIdentity, seq: number): ServerEvent => ({
  ...turn,
  schemaVersion: 3,
  eventId: `event${seq}`,
  seq,
  type: 'ready',
  payload: { streamId: 'stream', remainingLifetimeMs: 120_000 },
});
const tick = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
function setup(
  responder?: (path: string, body: unknown) => Response | Promise<Response> | undefined,
  audioFail = false,
) {
  const store = useSceneStore();
  const requests: Array<{ path: string; body: unknown }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    requests.push({ path, body });
    const custom = responder?.(path, body);
    if (custom) return custom;
    if (path === '/api/sessions') return json(session);
    if (path.endsWith('/turns')) {
      return begunResponse(body);
    }
    if (path.endsWith('/receipts')) return json({ acknowledged: [] });
    if (path.endsWith('/cancel')) return json({ status: 'cancelled' });
    throw new Error(`Unexpected test request ${path}`);
  };
  const api = new ApiClient('http://localhost:3000', fetcher);
  const playback = new PlaybackScheduler({
    audio: {
      unlock: async () => undefined,
      prepare: async () => {
        if (audioFail) throw new Error('AUDIO_FAILED');
        return { start: () => () => undefined };
      },
      dispose: async () => undefined,
    },
    presentation: {
      photo: async () => undefined,
      environment: async () => undefined,
      clear: () => undefined,
    },
    view: (value) => store.$patch(value),
    receipt: (value, turn) => controller.receipt(value, turn),
    expired: (turn) => controller.expire(turn),
    failure: (message) => {
      store.failure = message;
    },
  });
  const controller = new TurnController(api, playback, store);
  return { store, requests, controller, playback };
}
beforeEach(() => setActivePinia(createPinia()));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function mockMicrophone() {
  vi.spyOn(recording, 'acquireMicrophone').mockResolvedValue({
    stop: vi.fn(),
    recorder(callbacks) {
      return {
        mimeType: 'audio/webm',
        start() {},
        stop() {
          callbacks.chunk(new Blob(['recorded audio'], { type: 'audio/webm' }));
          callbacks.stopped();
        },
      };
    },
  });
}
describe('turn controller network ownership', () => {
  it('keeps recognized words as a draft until confirmation sends only the edited text', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    mockMicrophone();
    const h = setup((path) => {
      if (path.endsWith('/transcription'))
        return json({
          sessionId: 'session',
          generation: 1,
          turnId: path.split('/')[5],
          text: '识别出的原始消息',
          simulated: false,
        });
      if (path.endsWith('/input'))
        return new Response('', { headers: { 'content-type': 'text/event-stream' } });
      return undefined;
    });
    await h.controller.connect();
    h.controller.press();
    await tick();
    vi.advanceTimersByTime(650);
    h.controller.release();
    await tick();
    expect(h.store.voicePreview).toBe('ready');
    expect(h.store.voiceDraft).toBe('识别出的原始消息');
    expect(h.store.transcribed).toBe('');
    expect(h.requests.filter((request) => request.path.endsWith('/input'))).toHaveLength(0);
    h.controller.send('修改后的消息');
    await tick();
    const input = h.requests.filter((request) => request.path.endsWith('/input'));
    expect(input).toHaveLength(1);
    expect(input[0]?.body).toMatchObject({ text: '修改后的消息', generation: 2 });
    expect(h.requests.filter((request) => request.path.endsWith('/transcription'))).toHaveLength(1);
    await h.controller.dispose();
  });
  it('discards a late transcription after cancellation without overwriting an editable draft', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    mockMicrophone();
    let finish!: (response: Response) => void;
    let previewTurn = '';
    const h = setup((path) => {
      if (!path.endsWith('/transcription')) return undefined;
      previewTurn = path.split('/')[5] ?? '';
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    });
    await h.controller.connect();
    h.controller.press();
    await tick();
    vi.advanceTimersByTime(650);
    h.controller.release();
    await tick();
    expect(h.store.voicePreview).toBe('transcribing');
    h.controller.discardVoicePreview();
    finish(
      json({
        sessionId: 'session',
        generation: 1,
        turnId: previewTurn,
        text: '迟到的旧识别',
        simulated: false,
      }),
    );
    await tick();
    expect(h.store.voicePreview).toBe('idle');
    expect(h.store.voiceDraft).toBe('');
    expect(h.requests.filter((request) => request.path.endsWith('/input'))).toHaveLength(0);
    await h.controller.dispose();
  });
  it('disabled speech capability does not acquire a microphone, interrupt playback or begin a new turn', async () => {
    const h = setup();
    await h.controller.connect();
    h.store.voiceInput = false;
    const requests = h.requests.length;
    const cancel = vi.spyOn(h.playback, 'cancel');
    h.controller.press();
    h.controller.release();
    await tick();
    expect(h.store.failure).toBe('当前模式暂不支持语音输入，请使用文字输入。');
    expect(h.store.recording).toBe('idle');
    expect(h.requests).toHaveLength(requests);
    expect(cancel).not.toHaveBeenCalled();
    await h.controller.dispose();
  });
  it('expires unconfirmed subtitles before the server deadline and starts the next turn with no late receipt', async () => {
    vi.useFakeTimers();
    const h = setup((path, body) => {
      if (!path.endsWith('/input')) return undefined;
      const input = TextInputSchema.parse(body);
      const identity = {
        sessionId: 'session',
        generation: input.generation,
        turnId: path.split('/')[5] ?? '',
      };
      const envelope = event(identity, 1);
      const ready: ServerEvent = {
        ...envelope,
        type: 'ready',
        payload: { streamId: 'stream', remainingLifetimeMs: 2_500 },
      };
      const audio: ServerEvent = {
        ...envelope,
        seq: 2,
        eventId: 'audio',
        type: 'audio.ready',
        payload: {
          segmentId: 'sentence',
          text: input.text,
          audioUrl: '/api/media/sentence',
          emotion: 'curious',
          action: 'none',
          events: [],
        },
      };
      const done: ServerEvent = {
        ...envelope,
        seq: 3,
        eventId: 'done',
        type: 'reply.done',
        payload: { segmentCount: 1 },
      };
      return new Response(
        [ready, audio, done].map((value) => `data: ${JSON.stringify(value)}\n\n`).join(''),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    }, true);
    await h.controller.connect();
    h.controller.send('旧字幕');
    await tick();
    expect(h.store.playback).toBe('audio-error');
    await h.playback.useText();
    expect(h.store.playback).toBe('text');
    await vi.advanceTimersByTimeAsync(1_499);
    expect(h.store.playback).toBe('text');
    await vi.advanceTimersByTimeAsync(1);
    expect(h.store.playback).toBe('idle');
    expect(h.store.failure).toContain('这次回应已结束');
    await h.playback.continueText();
    expect(h.requests.filter((request) => request.path.endsWith('/receipts'))).toHaveLength(0);
    const cancelled = h.requests.find((request) => request.path.endsWith('/cancel'));
    expect(cancelled?.body).toMatchObject({ generation: 1, receipts: [], frozen: true });
    h.controller.send('新字幕');
    await tick();
    const latestBegin = h.requests.filter((request) => request.path.endsWith('/turns')).at(-1);
    expect(latestBegin?.body).toMatchObject({
      generation: 2,
      receipts: [],
      frozenTurns: [{ generation: 1, receipts: [] }],
    });
    await h.playback.useText();
    expect(h.store.subtitle).toBe('新字幕');
    await h.playback.continueText();
    await tick();
    const submitted = h.requests.filter((request) => request.path.endsWith('/receipts'));
    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.body).toMatchObject({
      receipts: [{ generation: 2, status: 'presented', mode: 'text' }],
    });
    await h.controller.dispose();
  });

  it('waits for begin acknowledgement before submitting input', async () => {
    let accept: ((value: Response) => void) | undefined;
    let begun: unknown;
    const h = setup((path, body) => {
      if (path.endsWith('/turns')) {
        begun = body;
        return new Promise<Response>((resolve) => {
          accept = resolve;
        });
      }
      if (path.endsWith('/input'))
        return new Response('data: invalid\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        });
    });
    await h.controller.connect();
    h.controller.send('你好');
    await tick();
    expect(h.requests.filter((request) => request.path.endsWith('/input'))).toHaveLength(0);
    accept?.(begunResponse(begun));
    await tick();
    expect(h.requests.filter((request) => request.path.endsWith('/input'))).toHaveLength(1);
    await h.controller.dispose();
  });
  it('an old begin resolving after a new begin cannot submit or clear the new turn', async () => {
    const pending: Array<{ body: unknown; accept: (value: Response) => void }> = [];
    const h = setup((path, body) => {
      if (path.endsWith('/turns'))
        return new Promise<Response>((accept) => {
          pending.push({ body, accept });
        });
      if (path.endsWith('/input')) {
        const turnId = path.split('/')[5] ?? '';
        const turn = { sessionId: 'session', generation: 2, turnId };
        const ready = event(turn, 1);
        const done: ServerEvent = {
          ...ready,
          seq: 2,
          eventId: 'done',
          type: 'reply.done',
          payload: { segmentCount: 0 },
        };
        return new Response(`data: ${JSON.stringify(ready)}\n\ndata: ${JSON.stringify(done)}\n\n`, {
          headers: { 'content-type': 'text/event-stream' },
        });
      }
    });
    await h.controller.connect();
    h.controller.send('旧句子');
    h.controller.send('新句子');
    const newer = pending[1];
    newer?.accept(begunResponse(newer.body));
    await tick();
    const older = pending[0];
    older?.accept(begunResponse(older.body));
    await tick();
    const inputs = h.requests.filter((request) => request.path.endsWith('/input'));
    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.body).toMatchObject({ text: '新句子', generation: 2 });
    expect(h.store.failure).toBe('');
    await h.controller.dispose();
  });
  it('malformed identity/version/sequence aborts the active stream and clears presentation', async () => {
    const h = setup((path) =>
      path.endsWith('/input')
        ? new Response('data: {"schemaVersion":99}\n\n', {
            headers: { 'content-type': 'text/event-stream' },
          })
        : undefined,
    );
    const cancel = vi.spyOn(h.playback, 'cancel');
    await h.controller.connect();
    h.controller.send('你好');
    await tick();
    expect(h.store.failure).toContain('连接暂时断开');
    expect(cancel).toHaveBeenCalled();
    expect(h.store.interaction).toBe('idle');
    await h.controller.dispose();
  });
});

describe('automatic connection recovery', () => {
  it('stops automatic retries after permanent initialization failure and permits explicit retry', async () => {
    let failing = true;
    const h = setup((path) =>
      path === '/api/sessions' && failing
        ? new Response(
            JSON.stringify({
              error: { code: 'INTERNAL_ERROR', message: '初始化失败', retryable: false },
              requestId: 'r',
            }),
            { status: 500 },
          )
        : undefined,
    );
    await h.controller.connect();
    h.controller.connectionLost();
    await h.controller.recoverConnection(true);
    expect(h.requests).toHaveLength(1);
    expect(h.store.failure).toBe('初始化失败');
    failing = false;
    await h.controller.connect();
    expect(h.store.connected).toBe(true);
    await h.controller.dispose();
  });
  it('keeps a 429 cooldown across forced recovery, visibility changes and explicit reconnect', async () => {
    vi.useFakeTimers();
    let failing = true;
    const h = setup((path) =>
      path === '/api/sessions' && failing
        ? new Response(
            JSON.stringify({
              error: { code: 'RATE_LIMITED', message: '稍后再试', retryable: true },
              requestId: 'r',
            }),
            { status: 429 },
          )
        : undefined,
    );
    await h.controller.connect();
    failing = false;
    await h.controller.recoverConnection(true);
    h.controller.pauseRecovery();
    h.controller.connectionLost();
    await h.controller.connect(true);
    vi.advanceTimersByTime(59_999);
    await h.controller.recoverConnection(true);
    expect(h.requests).toHaveLength(1);
    vi.advanceTimersByTime(1);
    await h.controller.recoverConnection(true);
    expect(h.requests).toHaveLength(2);
    expect(h.store.connected).toBe(true);
    await h.controller.dispose();
  });
  it('coalesces concurrent initial connection requests', async () => {
    let release!: (response: Response) => void;
    const h = setup((path) =>
      path === '/api/sessions'
        ? new Promise<Response>((resolve) => {
            release = resolve;
          })
        : undefined,
    );
    const first = h.controller.connect();
    await h.controller.connect();
    await h.controller.recoverConnection(true);
    expect(h.requests).toHaveLength(1);
    release(json(session));
    await first;
    expect(h.store.connected).toBe(true);
    await h.controller.dispose();
  });
  it('restores a snapshot without replaying the old input or creating another session', async () => {
    const h = setup((path) =>
      path === '/api/sessions/session'
        ? json({
            sessionId: 'session',
            generation: 0,
            capabilities: session.capabilities,
            scene: session.scene,
            history: [],
          })
        : undefined,
    );
    await h.controller.connect();
    h.controller.connectionLost();
    await h.controller.recoverConnection(true);
    expect(h.store.connected).toBe(true);
    expect(h.requests.filter((r) => r.path === '/api/sessions')).toHaveLength(1);
    expect(h.requests.filter((r) => r.path.endsWith('/input'))).toHaveLength(0);
    await h.controller.dispose();
  });
  it('requires explicit restart after the server has lost the old session', async () => {
    const h = setup((path) =>
      path === '/api/sessions/session'
        ? new Response(
            JSON.stringify({
              error: { code: 'SESSION_EXPIRED', message: '会话已结束', retryable: true },
              requestId: 'r',
            }),
            { status: 410 },
          )
        : undefined,
    );
    await h.controller.connect();
    h.controller.connectionLost();
    await h.controller.recoverConnection(true);
    expect(h.store.sessionExpired).toBe(true);
    const count = h.requests.length;
    await h.controller.recoverConnection(true);
    expect(h.requests).toHaveLength(count);
    expect(h.requests.filter((r) => r.path === '/api/sessions')).toHaveLength(1);
    await h.controller.dispose();
  });
  it('does not interrupt an already connected session on routine reachability updates', async () => {
    const h = setup();
    await h.controller.connect();
    const count = h.requests.length;
    const cancel = vi.spyOn(h.playback, 'cancel');
    await h.controller.recoverConnection();
    expect(h.requests).toHaveLength(count);
    expect(cancel).not.toHaveBeenCalled();
    await h.controller.dispose();
  });
});

describe('recovery response ownership', () => {
  it('a paused old snapshot cannot overwrite the restored session', async () => {
    let release!: (response: Response) => void;
    let snapshots = 0;
    const snapshot = (environment: string) => ({
      sessionId: 'session',
      generation: 0,
      capabilities: session.capabilities,
      scene: {
        ...session.scene,
        environment,
        facts: { ...session.scene.facts, rain_softened: environment === 'rain-soft' },
      },
      history: [],
    });
    const h = setup((path) => {
      if (path !== '/api/sessions/session') return undefined;
      snapshots += 1;
      if (snapshots === 1)
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      return json(snapshot('rain-soft'));
    });
    await h.controller.connect();
    h.controller.connectionLost();
    const older = h.controller.recoverConnection(true);
    await tick();
    h.controller.pauseRecovery();
    await h.controller.recoverConnection(true);
    release(json(snapshot('rain')));
    await older;
    await tick();
    expect(h.store.connected).toBe(true);
    expect(h.store.environment).toBe('rain-soft');
    await h.controller.dispose();
  });
});

describe('manual verification does not disturb active work', () => {
  it('keeps an active input owner when a connection check is requested', async () => {
    let finish!: (response: Response) => void;
    const h = setup((path) =>
      path.endsWith('/input')
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : undefined,
    );
    await h.controller.connect();
    h.controller.send('你好');
    await tick();
    const cancel = vi.spyOn(h.playback, 'cancel');
    const count = h.requests.length;
    await h.controller.recoverConnection(true, true);
    expect(h.requests).toHaveLength(count);
    expect(cancel).not.toHaveBeenCalled();
    expect(h.store.connected).toBe(true);
    await h.controller.dispose();
    finish(new Response(''));
    await tick();
  });
});

describe('speech-input failure is not a disconnected session', () => {
  it('clears the failed preview and allows a fresh text input without reconnecting', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    mockMicrophone();
    const h = setup((path) => {
      if (path.endsWith('/transcription'))
        return new Response(
          JSON.stringify({
            error: { code: 'NO_SPEECH', message: '没有识别出语音', retryable: true },
            requestId: 'speech',
          }),
          { status: 422 },
        );
      if (path.endsWith('/input'))
        return new Response('', { headers: { 'content-type': 'text/event-stream' } });
      return undefined;
    });
    await h.controller.connect();
    h.controller.press();
    await tick();
    await vi.advanceTimersByTimeAsync(650);
    h.controller.release();
    await tick();
    expect(h.store.connected).toBe(true);
    expect(h.store.sessionExpired).toBe(false);
    expect(h.store.failure).toBe('');
    expect(h.store.voiceInputError).toBe('没有识别出语音');
    expect(h.store.voicePreview).toBe('idle');
    expect(h.store.recording).toBe('idle');
    expect(h.requests.filter((r) => r.path.endsWith('/input'))).toHaveLength(0);
    h.controller.send('直接输入文字');
    await tick();
    expect(h.requests.filter((r) => r.path.endsWith('/input'))).toHaveLength(1);
    expect(h.requests.filter((r) => r.path === '/api/sessions')).toHaveLength(1);
    expect(h.store.voiceInputError).toBe('');
    await h.controller.dispose();
  });
});
