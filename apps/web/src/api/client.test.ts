// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from './client.js';
const session = {
  sessionId: 's',
  sessionToken: 'x'.repeat(40),
  expiresAt: 99999999,
  mode: 'mock',
  capabilities: { voiceInput: true },
  scene: {
    character: 'mira',
    environment: 'rain',
    facts: { photo_revealed: false, rain_softened: false },
  },
};
afterEach(() => vi.unstubAllGlobals());
describe('browser API boundary', () => {
  it('sends the old session identity and bearer only for an explicit restart', async () => {
    const requests: Array<{ headers: Headers; body: unknown }> = [];
    const api = new ApiClient('http://localhost:3000', async (_input, init) => {
      requests.push({ headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      return new Response(
        JSON.stringify({
          ...session,
          sessionId: requests.length === 1 ? 's' : 'new-session',
          expiresAt: null,
        }),
      );
    });
    await api.createSession();
    await api.createSession(undefined, true);
    expect(requests[0]?.headers.has('Authorization')).toBe(false);
    expect(requests[0]?.body).toEqual({ entry: 'story' });
    expect(requests[1]?.headers.get('Authorization')).toBe(`Bearer ${session.sessionToken}`);
    expect(requests[1]?.body).toEqual({ entry: 'story', replaceSessionId: 's' });
    expect(api.credentials()).toMatchObject({ sessionId: 'new-session', expiresAt: null });
  });
  it('binds native fetch to globalThis, never to the ApiClient instance', async () => {
    const native = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(
        new Response(JSON.stringify(session), { headers: { 'content-type': 'application/json' } }),
      );
    });
    vi.stubGlobal('fetch', native);
    const api = new ApiClient('http://localhost:3000');
    await expect(api.createSession()).resolves.toMatchObject({ sessionId: 's' });
    expect(native).toHaveBeenCalledOnce();
  });
  it('discards a session response whose owner was cancelled', async () => {
    let complete!: (value: Response) => void;
    const native: typeof fetch = () =>
      new Promise<Response>((resolve) => {
        complete = resolve;
      });
    const api = new ApiClient('http://localhost:3000', native);
    const controller = new AbortController();
    const creating = api.createSession(controller.signal);
    controller.abort(new Error('REPLACED'));
    complete(new Response(JSON.stringify(session)));
    await expect(creating).rejects.toThrow('REPLACED');
    expect(() => api.snapshot()).toThrow('故事连接已结束');
  });
});

describe('monitoring API and controlled failures', () => {
  it('does not send the private session token to public monitoring routes', async () => {
    const headers: Headers[] = [];
    const fetcher: typeof fetch = async (url, init) => {
      headers.push(new Headers(init?.headers));
      return new Response(
        JSON.stringify(
          String(url).endsWith('/ping') ? { schemaVersion: 4, status: 'ok' } : session,
        ),
      );
    };
    const api = new ApiClient('http://localhost:3000', fetcher);
    await api.createSession();
    await api.probeConnection(new AbortController().signal);
    expect(headers.at(-1)?.has('Authorization')).toBe(false);
    expect(headers.at(-1)?.has('X-Session-Id')).toBe(false);
  });
  it('keeps an unstructured HTTP error distinct from a network outage', async () => {
    const api = new ApiClient(
      'http://localhost:3000',
      async () => new Response('<html>Bad gateway</html>', { status: 502 }),
    );
    await expect(api.createSession()).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      httpStatus: 502,
      retryable: true,
    });
  });
  it('bounds a request even if its fetch implementation ignores cancellation', async () => {
    vi.useFakeTimers();
    try {
      const api = new ApiClient('http://localhost:3000', () => new Promise(() => {}));
      const result = api.createSession();
      const assertion = expect(result).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
      await vi.advanceTimersByTimeAsync(10001);
      await assertion;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('scene module compatibility before applying server projections', () => {
  const expected = { id: 'sample-story', version: '1' };
  const compatible = { ...session, scene: { ...session.scene, scenario: expected } };
  const response = (body: unknown) => new Response(JSON.stringify(body));

  it('sends the expected module on both creation and authenticated replacement', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response(compatible));
    const api = new ApiClient('http://localhost:3000', fetcher, 'conversation', expected);
    await api.createSession();
    await api.createSession(undefined, true);
    expect(fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { entry: 'conversation', expectedScenario: expected },
      { entry: 'conversation', expectedScenario: expected, replaceSessionId: session.sessionId },
    ]);
  });

  it('preserves the original credentials when the server rejects an incompatible replacement', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(compatible))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 'SCENE_MODULE_VERSION_MISMATCH',
              message: '场景版本与服务端不一致，请刷新页面后重试。',
              retryable: false,
            },
            requestId: 'mismatch',
          }),
          { status: 409 },
        ),
      );
    const api = new ApiClient('http://localhost:3000', fetcher, 'story', expected);
    await api.createSession();
    await expect(api.createSession(undefined, true)).rejects.toMatchObject({
      code: 'SCENE_MODULE_VERSION_MISMATCH',
      retryable: false,
      httpStatus: 409,
    });
    expect(api.credentials()?.sessionId).toBe(session.sessionId);
  });

  it('rejects incompatible or unversioned sessions before binding their token', async () => {
    for (const scenario of [
      undefined,
      { id: 'other-story', version: '1' },
      { ...expected, version: '2' },
    ]) {
      const api = new ApiClient(
        'http://localhost:3000',
        async () =>
          response({
            ...session,
            scene: { ...session.scene, ...(scenario ? { scenario } : {}) },
          }),
        'conversation',
        expected,
      );
      await expect(api.createSession()).rejects.toMatchObject({
        code: 'SCENE_MODULE_VERSION_MISMATCH',
      });
      expect(() => api.snapshot()).toThrow('故事连接已结束');
    }
  });

  it('rechecks snapshot versions after a compatible session was created', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(compatible))
      .mockResolvedValueOnce(
        response({
          sessionId: session.sessionId,
          generation: 1,
          capabilities: session.capabilities,
          scene: { ...compatible.scene, scenario: { ...expected, version: '2' } },
          history: [],
        }),
      );
    const api = new ApiClient('http://localhost:3000', fetcher, 'story', expected);
    await expect(api.createSession()).resolves.toMatchObject({ scene: { scenario: expected } });
    await expect(api.snapshot()).rejects.toMatchObject({ code: 'SCENE_MODULE_VERSION_MISMATCH' });
  });
});
