import { cafeScenario } from './scenario/cafe/index.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SessionCreatedSchema,
  ServerEventSchema,
  TranscriptionPreviewSchema,
} from '@mira/protocol';
import { createApp } from './app.js';
import { ProviderError } from './providers/types.js';
import { testConfig, testMedia, testProviders, wav } from '../test/helpers.js';

const apps: Array<Awaited<ReturnType<typeof createApp>>> = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
async function setup(overrides: Record<string, string> = {}) {
  const config = testConfig(overrides);
  const providers = testProviders();
  const app = await createApp({ config, providers, media: testMedia(config), logger: false });
  apps.push(app);
  const created = SessionCreatedSchema.parse(
    (await app.inject({ method: 'POST', url: '/api/sessions' })).json(),
  );
  const headers = {
    authorization: `Bearer ${created.sessionToken}`,
    'x-session-id': created.sessionId,
  };
  const base = `/api/sessions/${created.sessionId}`;
  await app.inject({
    method: 'POST',
    url: `${base}/turns`,
    headers,
    payload: { generation: 1, turnId: 'turn' },
  });
  return { app, created, headers, base, providers };
}
function events(payload: string) {
  return payload
    .split('\n\n')
    .filter((frame) => frame.startsWith('data: '))
    .map((frame) => ServerEventSchema.parse(JSON.parse(frame.slice(6))));
}

describe('Fastify API boundaries', () => {
  it('replaces only the authenticated session and frees its slot on explicit restart', async () => {
    const { app, created, base, headers } = await setup({ MAX_SESSIONS: '1' });
    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers,
      payload: { entry: 'story', replaceSessionId: created.sessionId },
    });
    expect(response.statusCode).toBe(201);
    const next = SessionCreatedSchema.parse(response.json());
    expect(next.sessionId).not.toBe(created.sessionId);
    expect(next.expiresAt).toBeNull();
    expect(app.services.sessions.sessions.size).toBe(1);
    expect((await app.inject({ url: base, headers })).statusCode).toBe(410);
    const fresh = await app.inject({
      url: `/api/sessions/${next.sessionId}`,
      headers: { authorization: `Bearer ${next.sessionToken}` },
    });
    expect(fresh.json()).toMatchObject({ generation: 0, history: [] });
  });
  it('rejects replacement with another token without deleting the original session', async () => {
    const { app, created, base, headers } = await setup({ MAX_SESSIONS: '1' });
    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { authorization: `Bearer ${'x'.repeat(43)}` },
      payload: { replaceSessionId: created.sessionId },
    });
    expect(response.statusCode).toBe(401);
    expect(app.services.sessions.sessions.size).toBe(1);
    expect((await app.inject({ url: base, headers })).statusCode).toBe(200);
  });
  it('allows an explicit restart when the previous session is already gone', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { authorization: `Bearer ${'x'.repeat(43)}` },
      payload: { replaceSessionId: 'previous-process-session' },
    });
    expect(response.statusCode).toBe(201);
    expect(SessionCreatedSchema.parse(response.json()).expiresAt).toBeNull();
  });
  it('retries a failed message with fresh request IDs without duplicating planner history', async () => {
    const { app, base, headers, providers, created } = await setup();
    const plan = vi
      .spyOn(providers.planner, 'plan')
      .mockRejectedValueOnce(new ProviderError('PROVIDER_FAILED'));
    const synthesize = vi.spyOn(providers.tts, 'synthesize');
    const begin = (generation: number) =>
      app.inject({
        method: 'POST',
        url: `${base}/turns`,
        headers,
        payload: { generation, turnId: `attempt-${generation}`, messageId: 'message' },
      });
    const input = (generation: number) =>
      app.inject({
        method: 'POST',
        url: `${base}/turns/attempt-${generation}/input`,
        headers,
        payload: { generation, inputId: `input-${generation}`, text: '哈哈' },
      });
    expect((await begin(2)).statusCode).toBe(200);
    const failed = events((await input(2)).payload);
    expect(failed.at(-1)?.type).toBe('error');
    const before = (await app.inject({ url: base, headers })).json();
    expect(before.history).toEqual([]);
    expect(before.messageAttempts.at(-1)).toMatchObject({
      messageId: 'message',
      status: 'failed',
      retryable: true,
    });
    expect((await begin(3)).statusCode).toBe(200);
    const retried = events((await input(3)).payload);
    const audio = retried.find((frame) => frame.type === 'audio.ready');
    if (!audio || audio.type !== 'audio.ready') throw new Error('Missing retried response');
    expect(plan).toHaveBeenCalledTimes(2);
    expect(plan.mock.calls[1]?.[0]).toMatchObject({ text: '哈哈', history: [] });
    expect(synthesize).toHaveBeenCalledOnce();
    expect((await app.inject({ url: base, headers })).json().messageAttempts.at(-1).status).toBe(
      'pending',
    );
    await app.inject({
      method: 'POST',
      url: `${base}/receipts`,
      headers,
      payload: {
        receipts: [
          {
            sessionId: created.sessionId,
            generation: 3,
            turnId: 'attempt-3',
            receiptId: 'receipt',
            targetId: audio.payload.segmentId,
            kind: 'segment',
            status: 'presented',
            mode: 'audio',
          },
        ],
      },
    });
    const after = (await app.inject({ url: base, headers })).json();
    expect(after.history.filter((line: { role: string }) => line.role === 'user')).toEqual([
      { role: 'user', text: '哈哈' },
    ]);
    expect(after.messageAttempts.at(-1).status).toBe('completed');
    expect((await input(3)).statusCode).toBe(409);
    expect(plan).toHaveBeenCalledTimes(2);
  });

  it('previews transcription without dialogue or planner/TTS, then replies only to confirmed edited text', async () => {
    const { app, created, base, headers, providers } = await setup({ MAX_ACTIVE_TURNS: '1' });
    const plan = vi.spyOn(providers.planner, 'plan');
    const tts = vi.spyOn(providers.tts, 'synthesize');
    const stt = vi.spyOn(providers.stt, 'transcribe');
    const boundary = 'preview-voice';
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify({ generation: 1, inputId: 'preview', durationMs: 500 })}\r\n--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="voice.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
      ),
      Buffer.from(wav()),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const request = {
      method: 'POST' as const,
      url: `${base}/turns/turn/transcription`,
      headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    };
    const response = await app.inject(request);
    expect(response.statusCode, response.payload).toBe(200);
    const preview = TranscriptionPreviewSchema.parse(response.json());
    expect(preview).toMatchObject({
      sessionId: created.sessionId,
      turnId: 'turn',
      generation: 1,
      text: '这场雨什么时候停？',
      simulated: true,
    });
    expect(plan).not.toHaveBeenCalled();
    expect(tts).not.toHaveBeenCalled();
    const previewTurn = app.services.sessions.sessions.get(created.sessionId)?.current;
    expect(previewTurn?.firstAudioTimer).toBeUndefined();
    expect(previewTurn?.timer).toBeUndefined();
    const snapshot = (await app.inject({ method: 'GET', url: base, headers })).json();
    expect(snapshot.history).toEqual([]);
    expect(snapshot.scene.facts).toEqual({ photo_revealed: false, rain_softened: false });
    const repeat = await app.inject(request);
    expect(repeat.statusCode).toBe(409);
    expect(stt).toHaveBeenCalledOnce();
    await app.inject({
      method: 'POST',
      url: `${base}/turns`,
      headers,
      payload: { generation: 2, turnId: 'confirmed' },
    });
    const confirmed = await app.inject({
      method: 'POST',
      url: `${base}/turns/confirmed/input`,
      headers,
      payload: { generation: 2, inputId: 'edited-text', text: '我改主意了，聊聊旅行吧。' },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(plan).toHaveBeenCalledOnce();
    expect(plan.mock.calls[0]?.[0].text).toBe('我改主意了，聊聊旅行吧。');
    expect(tts).toHaveBeenCalledOnce();
    expect(stt).toHaveBeenCalledOnce();
    expect((await app.inject({ method: 'GET', url: base, headers })).json().history).toEqual([]);
  });
  it('rejects transcription preview when voice is disabled without decoding or generating a reply', async () => {
    const { app, base, headers, providers } = await setup({ FFMPEG_PATH: '/missing-decoder' });
    delete app.services.providers.stt;
    const plan = vi.spyOn(providers.planner, 'plan');
    const response = await app.inject({
      method: 'POST',
      url: `${base}/turns/turn/transcription`,
      headers,
    });
    expect(response.statusCode).toBe(415);
    expect(plan).not.toHaveBeenCalled();
    expect((await app.inject({ method: 'GET', url: base, headers })).json().history).toEqual([]);
  });
  it('is ready in zero-key mock mode and generates OpenAPI from runtime routes', async () => {
    const { app } = await setup();
    expect((await app.inject('/healthz')).json()).toEqual({ status: 'ok' });
    expect((await app.inject('/api/connection/ping')).json()).toEqual({
      schemaVersion: 3,
      status: 'ok',
    });
    expect((await app.inject('/readyz')).json()).toEqual({ status: 'ready', mode: 'mock' });
    expect(Object.keys(app.swagger().paths ?? {})).toHaveLength(10);
  });
  it('rejects unsupported speech before decoding or provider calls and accepts the next text turn', async () => {
    const { app, headers, base, providers } = await setup({
      APP_MODE: 'live',
      GPT_BASE_URL: 'https://gpt.example/v1',
      GPT_API_KEY: 'test-gpt',
      GPT_MODEL: 'test-model',
      DEEPGRAM_API_KEY: 'test-tts',
      DEEPGRAM_MODEL: 'flux-lijuan-zh',
      FFMPEG_PATH: '/missing-decoder',
    });
    delete app.services.providers.stt;
    const plan = vi.spyOn(providers.planner, 'plan');
    const synthesize = vi.spyOn(providers.tts, 'synthesize');
    const boundary = 'unsupported-speech';
    const response = await app.inject({
      method: 'POST',
      url: `${base}/turns/turn/input`,
      headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify({ generation: 1, inputId: 'voice', durationMs: 500 })}\r\n`,
        ),
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="voice.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
        ),
        Buffer.from(wav()),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
    const frames = events(response.payload);
    expect(frames.map((event) => event.type)).toEqual(['ready', 'error']);
    expect(frames[1]).toMatchObject({
      type: 'error',
      payload: {
        code: 'UNSUPPORTED_AUDIO',
        message: '当前模式暂不支持语音输入，请使用文字输入。',
        retryable: false,
      },
    });
    expect(plan).not.toHaveBeenCalled();
    expect(synthesize).not.toHaveBeenCalled();
    expect((await app.inject({ url: base, headers })).json().history).toEqual([]);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `${base}/turns`,
          headers,
          payload: { generation: 2, turnId: 'text-turn' },
        })
      ).statusCode,
    ).toBe(200);
    const next = await app.inject({
      method: 'POST',
      url: `${base}/turns/text-turn/input`,
      headers,
      payload: { generation: 2, inputId: 'text', text: '你好' },
    });
    expect(events(next.payload).map((event) => event.type)).toEqual([
      'ready',
      'audio.ready',
      'reply.done',
    ]);
    expect(plan).toHaveBeenCalledOnce();
    expect(synthesize).toHaveBeenCalledOnce();
  });
  it('streams ready before business events, protects media and commits only receipts', async () => {
    const { app, headers, base, created } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: `${base}/turns/turn/input`,
      headers,
      payload: { generation: 1, inputId: 'i', text: '你好' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    const frames = events(response.payload);
    expect(frames.map((event) => event.type)).toEqual(['ready', 'audio.ready', 'reply.done']);
    expect(frames.map((event) => event.seq)).toEqual([1, 2, 3]);
    const ready = frames[0];
    if (!ready || ready.type !== 'ready') throw new Error('missing ready');
    expect(ready.payload.remainingLifetimeMs).toBeGreaterThan(0);
    expect(ready.payload.remainingLifetimeMs).toBeLessThanOrEqual(
      app.services.config.TURN_MAX_LIFETIME_MS,
    );
    const audio = frames.find((event) => event.type === 'audio.ready');
    if (!audio || audio.type !== 'audio.ready') throw new Error('no audio');
    expect((await app.inject({ url: audio.payload.audioUrl, headers })).rawPayload.length).toBe(
      wav().length,
    );
    expect(
      (
        await app.inject({
          url: audio.payload.audioUrl,
          headers: { ...headers, authorization: 'Bearer wrong' },
        })
      ).statusCode,
    ).toBe(401);
    const before = (await app.inject({ url: base, headers })).json();
    expect(before.history).toHaveLength(0);
    const receipt = {
      sessionId: created.sessionId,
      turnId: 'turn',
      generation: 1,
      receiptId: 'receipt-1',
      targetId: audio.payload.segmentId,
      kind: 'segment',
      status: 'presented',
      mode: 'audio',
    };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `${base}/receipts`,
          headers,
          payload: { receipts: [receipt, receipt] },
        })
      ).json(),
    ).toEqual({ acknowledged: ['receipt-1'] });
    expect((await app.inject({ url: base, headers })).json().history).toHaveLength(2);
    expect(
      app.services.sessions.authenticate(created.sessionId, headers.authorization).current?.abort
        .signal.aborted,
    ).toBe(false);
  });
  it('rejects malformed input and same-identity retries without a second provider call', async () => {
    const { app, headers, base, providers } = await setup();
    const spy = vi.spyOn(providers.planner, 'plan');
    const request = {
      method: 'POST' as const,
      url: `${base}/turns/turn/input`,
      headers,
      payload: { generation: 1, inputId: 'i', text: '你好' },
    };
    expect(
      (await app.inject({ ...request, payload: { ...request.payload, text: '' } })).statusCode,
    ).toBe(400);
    expect((await app.inject(request)).statusCode).toBe(200);
    expect((await app.inject(request)).json().error.code).toBe('INPUT_COMPLETED');
    expect(
      (await app.inject({ ...request, payload: { ...request.payload, text: 'changed' } })).json()
        .error.code,
    ).toBe('INPUT_CONFLICT');
    expect(spy).toHaveBeenCalledOnce();
  });
  it('allows only exact CORS origins and the session header', async () => {
    const { app } = await setup();
    const good = await app.inject({
      method: 'OPTIONS',
      url: '/api/sessions',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,x-session-id',
      },
    });
    expect(good.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(good.headers['access-control-allow-headers']).toContain('X-Session-Id');
    const bad = await app.inject({
      method: 'OPTIONS',
      url: '/api/sessions',
      headers: { origin: 'https://evil.pages.dev', 'access-control-request-method': 'POST' },
    });
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('streams a sanitized error after ready without sending a second HTTP JSON response', async () => {
    const { app, headers, base, providers } = await setup();
    providers.planner.plan = async () => {
      throw new Error('secret-provider-key-and-stack');
    };
    const response = await app.inject({
      method: 'POST',
      url: `${base}/turns/turn/input`,
      headers,
      payload: { generation: 1, inputId: 'i', text: '你好' },
    });
    expect(response.statusCode).toBe(200);
    expect(events(response.payload).map((event) => event.type)).toEqual(['ready', 'error']);
    expect(response.payload).not.toContain('secret-provider');
  });
  it('bounds anonymous creation and global work capacity', async () => {
    const { app } = await setup({ MAX_SESSIONS_PER_MINUTE: '1' });
    const result = await app.inject({ method: 'POST', url: '/api/sessions' });
    expect(result.statusCode).toBe(429);
    expect(result.json().error.code).toBe('RATE_LIMITED');
  });
  it('allows demo creation beyond the per-minute quota but retains session capacity', async () => {
    const { app } = await setup({
      RATE_LIMIT_ENABLED: 'false',
      MAX_SESSIONS_PER_MINUTE: '1',
      MAX_SESSIONS: '3',
    });
    for (let i = 0; i < 2; i++)
      expect((await app.inject({ method: 'POST', url: '/api/sessions' })).statusCode).toBe(201);
    const full = await app.inject({ method: 'POST', url: '/api/sessions' });
    expect(full.statusCode).toBe(503);
    expect(full.json().error.code).toBe('CAPACITY_EXCEEDED');
  });
  it('does not charge failed initialization or report it as a provider failure', async () => {
    const config = testConfig({ RATE_LIMIT_ENABLED: 'true', MAX_SESSIONS_PER_MINUTE: '1' });
    const providers = testProviders();
    const plan = vi.spyOn(providers.planner, 'plan');
    const synthesize = vi.spyOn(providers.tts, 'synthesize');
    const app = await createApp({ config, providers, media: testMedia(config), logger: false });
    apps.push(app);
    vi.spyOn(app.services.sessions, 'create').mockImplementationOnce(() => {
      throw new Error('private-initialization-details');
    });
    const failure = await app.inject({ method: 'POST', url: '/api/sessions' });
    expect(failure.statusCode).toBe(500);
    expect(failure.json().error).toMatchObject({ code: 'INTERNAL_ERROR', retryable: false });
    expect(failure.payload).not.toContain('private-initialization-details');
    expect((await app.inject({ method: 'POST', url: '/api/sessions' })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/api/sessions' })).statusCode).toBe(429);
    expect(plan).not.toHaveBeenCalled();
    expect(synthesize).not.toHaveBeenCalled();
  });
  it('accepts multipart audio with real MIME, and rejects oversized files before providers', async () => {
    const { app, headers, base, providers } = await setup({ MAX_UPLOAD_BYTES: '256' });
    const spy = vi.spyOn(providers.stt, 'transcribe');
    const boundary = 'mira-test-boundary';
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify({ generation: 1, inputId: 'i', durationMs: 1000 })}\r\n--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="clip.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
      ),
      Buffer.alloc(300),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const large = await app.inject({
      method: 'POST',
      url: `${base}/turns/turn/input`,
      headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(large.statusCode, large.payload).toBe(413);
    expect(spy).not.toHaveBeenCalled();
  });
});

it('an abandoned socket and its late provider cannot cancel a newer HTTP stream', async () => {
  const { app, headers, base, providers, created } = await setup();
  let releaseOld!: (value: unknown) => void;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const oldPlan = new Promise<unknown>((resolve) => {
    releaseOld = resolve;
  });
  const successfulPlan = await testProviders().planner.plan(
    { text: '', facts: [], history: [] },
    new AbortController().signal,
  );
  providers.planner.plan = async (input) => {
    if (input.text === 'old') {
      markStarted();
      return oldPlan;
    }
    return successfulPlan;
  };
  const origin = await app.listen({ port: 0, host: '127.0.0.1' });
  const abort = new AbortController();
  const first = await fetch(`${origin}${base}/turns/turn/input`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ generation: 1, inputId: 'i', text: 'old' }),
    signal: abort.signal,
  });
  const reader = first.body!.getReader();
  const firstChunk = await reader.read();
  expect(new TextDecoder().decode(firstChunk.value)).toContain('"ready"');
  await started;
  abort.abort();
  await fetch(`${origin}${base}/turns`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      generation: 2,
      turnId: 'turn-new',
      frozenTurns: [{ generation: 1, turnId: 'turn', receipts: [] }],
    }),
  });
  const second = await fetch(`${origin}${base}/turns/turn-new/input`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ generation: 2, inputId: 'new-input', text: 'new' }),
  });
  expect(events(await second.text()).map((event) => event.type)).toEqual([
    'ready',
    'audio.ready',
    'reply.done',
  ]);
  releaseOld(successfulPlan);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const session = app.services.sessions.authenticate(created.sessionId, headers.authorization);
  expect(session.current?.identity.turnId).toBe('turn-new');
  expect(session.current?.abort.signal.aborted).toBe(false);
});

it('first-audio timeout ends a non-cooperative provider and releases capacity', async () => {
  const { app, headers, base, providers } = await setup({
    FIRST_AUDIO_TIMEOUT_MS: '30',
    TURN_MAX_LIFETIME_MS: '1000',
    MAX_ACTIVE_TURNS: '1',
  });
  providers.planner.plan = async () => new Promise<unknown>(() => undefined);
  const response = await app.inject({
    method: 'POST',
    url: `${base}/turns/turn/input`,
    headers,
    payload: { generation: 1, inputId: 'slow', text: '你好' },
  });
  expect(events(response.payload).at(-1)?.payload).toMatchObject({ code: 'FIRST_AUDIO_TIMEOUT' });
  providers.planner.plan = testProviders().planner.plan;
  await app.inject({
    method: 'POST',
    url: `${base}/turns`,
    headers,
    payload: { generation: 2, turnId: 'next' },
  });
  const next = await app.inject({
    method: 'POST',
    url: `${base}/turns/next/input`,
    headers,
    payload: { generation: 2, inputId: 'ok', text: '你好' },
  });
  expect(events(next.payload).at(-1)?.type).toBe('reply.done');
});

it('normalizes an actual multipart recording before simulated STT and the shared graph', async () => {
  const { app, headers, base, providers } = await setup();
  const spy = vi.spyOn(providers.stt, 'transcribe');
  const boundary = 'mira-valid-recording';
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify({ generation: 1, inputId: 'i', durationMs: 500 })}\r\n--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="clip.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
    ),
    Buffer.from(wav()),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const response = await app.inject({
    method: 'POST',
    url: `${base}/turns/turn/input`,
    headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload,
  });
  expect(response.statusCode, response.payload).toBe(200);
  expect(events(response.payload).map((event) => event.type)).toEqual([
    'ready',
    'input.transcribed',
    'audio.ready',
    'reply.done',
  ]);
  expect(spy).toHaveBeenCalledOnce();
  expect(spy.mock.calls[0]?.[0].mimeType).toBe('audio/wav');
});

it('merges a receipt-confirmed Ink prefix when disconnect beats the frozen snapshot', async () => {
  const { app, headers, base, created } = await setup();
  const session = app.services.sessions.authenticate(created.sessionId, headers.authorization);
  for (const action of ['move-lobby', 'move-counter'])
    for (const beat of cafeScenario.propose(action, session.narrative))
      session.narrative = cafeScenario.accept(session.narrative, beat.checkpoint);
  const frame = cafeScenario.frame(session.narrative);
  session.story = frame.story;
  session.facts = frame.facts;
  const origin = await app.listen({ port: 0, host: '127.0.0.1' });
  const abort = new AbortController();
  const response = await fetch(`${origin}${base}/turns/turn/input`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      generation: 1,
      inputId: 'read',
      interaction: { kind: 'inspect', prop: 'letter' },
    }),
    signal: abort.signal,
  });
  const reader = response.body!.getReader();
  let body = '';
  while (!body.includes('"presentation.ready"')) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error('missing presentation');
    body += new TextDecoder().decode(chunk.value);
  }
  const frames = events(body);
  const audio = frames.find((event) => event.type === 'audio.ready');
  const presentation = frames.find((event) => event.type === 'presentation.ready');
  if (audio?.type !== 'audio.ready' || presentation?.type !== 'presentation.ready')
    throw new Error('missing story targets');
  abort.abort();
  await vi.waitFor(() => expect(session.current?.abort.signal.aborted).toBe(true));
  const identity = { sessionId: created.sessionId, generation: 1, turnId: 'turn' };
  const receipts = [
    {
      ...identity,
      receiptId: 'heard',
      targetId: audio.payload.segmentId,
      kind: 'segment',
      status: 'presented',
      mode: 'audio',
    },
    {
      ...identity,
      receiptId: 'read',
      targetId: presentation.payload.events[0]!.eventId,
      kind: 'prop',
      status: 'presented',
    },
  ];
  const next = await fetch(`${origin}${base}/turns`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      generation: 2,
      turnId: 'next',
      receipts,
      frozenTurns: [{ generation: 1, turnId: 'turn', receipts }],
    }),
  });
  expect(next.status).toBe(200);
  const snapshot = (await app.inject({ url: base, headers })).json();
  expect(snapshot.scene.story.revealed).toContain('letter');
  expect(snapshot.scene.story.phase).toBe('exploration');
  expect(snapshot.generation).toBe(2);
});

it('aborts a hanging old upload and immediately gives the new turn its own input slot', async () => {
  const { request: httpRequest } = await import('node:http');
  const { app, headers, base, created } = await setup({ MAX_ACTIVE_TURNS: '1' });
  const origin = await app.listen({ port: 0, host: '127.0.0.1' });
  const boundary = 'mira-hanging-upload';
  const oldRequest = httpRequest(`${origin}${base}/turns/turn/input`, {
    method: 'POST',
    headers: {
      ...headers,
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'transfer-encoding': 'chunked',
    },
  });
  const closed = new Promise<void>((resolve) => {
    oldRequest.once('error', () => resolve());
    oldRequest.once('close', resolve);
  });
  oldRequest.write(
    `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify({ generation: 1, inputId: 'never-complete', durationMs: 500 })}\r\n--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="clip.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
  );
  oldRequest.write(Buffer.from(wav()).subarray(0, 100));
  const session = app.services.sessions.authenticate(created.sessionId, headers.authorization);
  const oldTurn = session.current!;
  try {
    await vi.waitFor(() => expect(oldTurn.uploadRequestId).toBeDefined());
    expect(oldTurn.input).toBeUndefined();
    const nextBegin = await fetch(`${origin}${base}/turns`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        generation: 2,
        turnId: 'new-upload-owner',
        frozenTurns: [{ generation: 1, turnId: 'turn', receipts: [] }],
      }),
    });
    expect(nextBegin.status).toBe(200);
    const nextInput = await fetch(`${origin}${base}/turns/new-upload-owner/input`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ generation: 2, inputId: 'new-input', text: '你好' }),
    });
    expect(nextInput.status).toBe(200);
    expect(events(await nextInput.text()).at(-1)?.type).toBe('reply.done');
    await closed;
    expect(oldTurn.abort.signal.aborted).toBe(true);
    expect(oldTurn.uploadRequestId).toBeUndefined();
    expect(session.current?.identity.turnId).toBe('new-upload-owner');
    expect(session.current?.abort.signal.aborted).toBe(false);
  } finally {
    oldRequest.destroy();
  }
});

it('returns a specific speech-input failure while keeping the session usable for text', async () => {
  const { app, created, base, headers, providers } = await setup();
  vi.spyOn(providers.stt, 'transcribe').mockRejectedValue(new ProviderError('NO_SPEECH'));
  const plan = vi.spyOn(providers.planner, 'plan'),
    tts = vi.spyOn(providers.tts, 'synthesize');
  const boundary = 'empty-speech';
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify({ generation: 1, inputId: 'empty', durationMs: 500 })}\r\n--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="voice.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
    ),
    Buffer.from(wav()),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const response = await app.inject({
    method: 'POST',
    url: `${base}/turns/turn/transcription`,
    headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload,
  });
  expect(response.statusCode).toBe(422);
  expect(response.json()).toMatchObject({ error: { code: 'NO_SPEECH', retryable: true } });
  expect(plan).not.toHaveBeenCalled();
  expect(tts).not.toHaveBeenCalled();
  expect((await app.inject({ method: 'GET', url: `${base}`, headers })).statusCode).toBe(200);
  await app.inject({
    method: 'POST',
    url: `${base}/turns`,
    headers,
    payload: { generation: 2, turnId: 'text-next' },
  });
  const next = await app.inject({
    method: 'POST',
    url: `${base}/turns/text-next/input`,
    headers,
    payload: { generation: 2, inputId: 'typed', text: '你好' },
  });
  expect(events(next.payload).at(-1)?.type).toBe('reply.done');
  expect(app.services.sessions.authenticate(created.sessionId, headers.authorization).id).toBe(
    created.sessionId,
  );
});
