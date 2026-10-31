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
