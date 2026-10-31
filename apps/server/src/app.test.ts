import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionCreatedSchema, ServerEventSchema } from '@mira/protocol';
import { createApp } from './app.js';
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
  it('is ready in zero-key mock mode and generates OpenAPI from runtime routes', async () => {
    const { app } = await setup();
    expect((await app.inject('/healthz')).json()).toEqual({ status: 'ok' });
    expect((await app.inject('/readyz')).json()).toEqual({ status: 'ready', mode: 'mock' });
    expect(Object.keys(app.swagger().paths ?? {})).toHaveLength(9);
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
    expect(before.history).toHaveLength(1);
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

it('preserves a presented photo when aborting the socket beats the explicit frozen snapshot', async () => {
  const { app, headers, base, providers, created } = await setup();
  providers.planner.plan = async () => ({
    segments: [
      {
        text: '给你看照片。',
        emotion: 'relieved',
        action: 'offerPhoto',
        events: [{ type: 'photo', resourceId: 'travel_photo_01' }],
      },
      {
        text: '雨小了。',
        emotion: 'relieved',
        action: 'lookWindow',
        events: [{ type: 'environment', environment: 'rain-soft' }],
      },
    ],
  });
  const origin = await app.listen({ port: 0, host: '127.0.0.1' });
  const abort = new AbortController();
  const response = await fetch(`${origin}${base}/turns/turn/input`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ generation: 1, inputId: 'photo', text: '能看看照片吗？' }),
    signal: abort.signal,
  });
  const reader = response.body!.getReader();
  let body = '';
  while (!body.includes('"audio.ready"')) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error('stream ended before photo');
    body += new TextDecoder().decode(chunk.value);
  }
  const audio = events(body).find((event) => event.type === 'audio.ready');
  if (!audio || audio.type !== 'audio.ready') throw new Error('missing audio');
  const photo = audio.payload.events.find((event) => event.type === 'photo');
  if (!photo) throw new Error('missing photo');
  abort.abort();
  // Model a real response-close notification arriving before the subsequent HTTP begin.
  await vi.waitFor(() =>
    expect(
      app.services.sessions.authenticate(created.sessionId, headers.authorization).current?.abort
        .signal.aborted,
    ).toBe(true),
  );
  const receipt = {
    sessionId: created.sessionId,
    turnId: 'turn',
    generation: 1,
    receiptId: 'seen-photo',
    targetId: photo.eventId,
    kind: 'photo',
    status: 'presented',
  };
  const next = await fetch(`${origin}${base}/turns`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      generation: 2,
      turnId: 'next',
      receipts: [receipt],
      frozenTurns: [{ generation: 1, turnId: 'turn', receipts: [receipt] }],
    }),
  });
  expect(next.status).toBe(200);
  const snapshot = (await app.inject({ url: base, headers })).json();
  expect(snapshot.scene.facts).toEqual({ photo_revealed: true, rain_softened: false });
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
