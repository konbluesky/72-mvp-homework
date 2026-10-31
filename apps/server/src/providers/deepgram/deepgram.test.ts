import { describe, expect, it, vi } from 'vitest';
import { DeepgramClient } from './client.js';
import { DeepgramStt } from './stt.js';
import { DeepgramTts } from './tts.js';
import { publicError } from '../../http/errors.js';
import { wav } from '../../../test/helpers.js';
import { transcriptResponse } from '../../../../../tests/fixtures/provider-http.js';
import type { Fetch } from '../http.js';
const signal = () => new AbortController().signal;
const stt = (http: Fetch, timeoutMs = 100) =>
  new DeepgramStt(
    new DeepgramClient({ apiKey: 'test-key', baseUrl: 'https://api.deepgram.com' }, http),
    { model: 'nova-3', language: 'zh-CN', timeoutMs, maxInputBytes: 4194304 },
  );
const mp3 = new Uint8Array([0xff, 0xfb, 0x90, 0, 1, 2, 3, 4]);
describe('Deepgram speech contracts', () => {
  it('posts binary normalized WAV to v1/listen with Chinese Nova-3 and validates transcript metadata', async () => {
    const http = vi.fn<Fetch>().mockResolvedValue(
      Response.json(transcriptResponse('  请给我看看照片。  '), {
        headers: { 'dg-request-id': 'header-request' },
      }),
    );
    const audio = { bytes: wav(), mimeType: 'audio/wav' };
    expect(await stt(http).transcribe(audio, signal())).toEqual({
      text: '请给我看看照片。',
      simulated: false,
      requestId: 'stt-request',
      durationSeconds: 0.5,
    });
    const [url, options] = http.mock.calls[0]!;
    expect(String(url)).toBe(
      'https://api.deepgram.com/v1/listen?model=nova-3&language=zh-CN&smart_format=true',
    );
    expect(options?.headers).toEqual({
      Authorization: 'Token test-key',
      'Content-Type': 'audio/wav',
      Accept: 'application/json',
    });
    expect(options?.redirect).toBe('error');
    expect(Buffer.from(options?.body instanceof Uint8Array ? options.body : [])).toEqual(
      Buffer.from(audio.bytes),
    );
    expect(http).toHaveBeenCalledOnce();
  });
  it.each([
    {},
    { metadata: { request_id: 'r', duration: 1 }, results: { channels: [] } },
    { metadata: { request_id: 'r', duration: 1 }, results: { channels: [{ alternatives: [] }] } },
    transcriptResponse('x'.repeat(1001)),
  ])('rejects malformed responses without producing a transcript', async (value) => {
    const http = vi.fn<Fetch>().mockResolvedValue(Response.json(value));
    await expect(
      stt(http).transcribe({ bytes: wav(), mimeType: 'audio/wav' }, signal()),
    ).rejects.toMatchObject({ code: 'PROVIDER_FAILED' });
  });
  it('distinguishes silence from vendor failure and never substitutes a mock transcript', async () => {
    const http = vi.fn<Fetch>().mockResolvedValue(Response.json(transcriptResponse('   ')));
    let error: unknown;
    try {
      await stt(http).transcribe({ bytes: wav(), mimeType: 'audio/wav' }, signal());
    } catch (reason) {
      error = reason;
    }
    expect(publicError(error)).toMatchObject({
      code: 'INVALID_REQUEST',
      status: 400,
      retryable: true,
    });
    expect(http).toHaveBeenCalledOnce();
  });
  it.each([401, 403, 429, 500])(
    'maps HTTP %i without leaking vendor bodies or the API key',
    async (status) => {
      const http = vi
        .fn<Fetch>()
        .mockResolvedValue(
          Response.json(
            { error: 'private vendor details and test-key' },
            { status, headers: { 'dg-request-id': 'failure-request' } },
          ),
        );
      let error: unknown;
      try {
        await stt(http).transcribe({ bytes: wav(), mimeType: 'audio/wav' }, signal());
      } catch (reason) {
        error = reason;
      }
      expect(error).toMatchObject({
        code: 'PROVIDER_FAILED',
        details: { provider: 'deepgram', status, requestId: 'failure-request' },
      });
      expect(publicError(error).retryable).toBe(status === 429 || status >= 500);
      expect(publicError(error).message).not.toContain('test-key');
      expect(publicError(error).message).not.toContain('private');
    },
  );
  it('bounds JSON size, rejects non-JSON, wrong audio input and invalid UTF-8', async () => {
    const http = vi
      .fn<Fetch>()
      .mockResolvedValue(
        new Response('x'.repeat(131073), { headers: { 'Content-Type': 'application/json' } }),
      );
    await expect(
      stt(http).transcribe({ bytes: wav(), mimeType: 'audio/wav' }, signal()),
    ).rejects.toThrow();
    http.mockResolvedValue(
      new Response('<html>not JSON</html>', { headers: { 'Content-Type': 'text/html' } }),
    );
    await expect(
      stt(http).transcribe({ bytes: wav(), mimeType: 'audio/wav' }, signal()),
    ).rejects.toThrow();
    http.mockResolvedValue(
      new Response(new Uint8Array([0xff]), { headers: { 'Content-Type': 'application/json' } }),
    );
    await expect(
      stt(http).transcribe({ bytes: wav(), mimeType: 'audio/wav' }, signal()),
    ).rejects.toThrow();
    const requests = http.mock.calls.length;
    await expect(
      stt(http).transcribe({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'audio/wav' }, signal()),
    ).rejects.toThrow();
    expect(http).toHaveBeenCalledTimes(requests);
  });
  it('cancels a non-cooperative recognizer and discards its eventual response', async () => {
    let finish!: (response: Response) => void;
    const http = vi.fn<Fetch>(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const controller = new AbortController();
    const pending = stt(http).transcribe(
      { bytes: wav(), mimeType: 'audio/wav' },
      controller.signal,
    );
    controller.abort(new Error('new-turn'));
    await expect(pending).rejects.toThrow('new-turn');
    expect(http.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    finish(Response.json(transcriptResponse('late')));
  });
  it('times out recognition independently and passes cancellation into the response body', async () => {
    const http = vi.fn<Fetch>(() => new Promise(() => undefined));
    await expect(
      stt(http, 5).transcribe({ bytes: wav(), mimeType: 'audio/wav' }, signal()),
    ).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
    expect(http.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    const cancelled = vi.fn();
    http.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('{'));
          },
          cancel: cancelled,
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await expect(
      stt(http, 5).transcribe({ bytes: wav(), mimeType: 'audio/wav' }, signal()),
    ).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it('shares auth/transport but keeps STT and TTS model and timeout options separate', async () => {
    const http = vi.fn<Fetch>().mockImplementation(async (url) =>
      String(url).includes('/listen')
        ? Response.json(transcriptResponse())
        : new Response(mp3, {
            headers: { 'Content-Type': 'audio/mpeg', 'dg-request-id': 'tts-request' },
          }),
    );
    const client = new DeepgramClient(
      { apiKey: 'shared-key', baseUrl: 'https://api.deepgram.com' },
      http,
    );
    const speech = new DeepgramStt(client, {
      model: 'nova-2',
      language: 'zh',
      timeoutMs: 100,
      maxInputBytes: 4194304,
    });
    const voice = new DeepgramTts(client, {
      model: 'flux-lijuan-zh',
      timeoutMs: 200,
      maxAudioBytes: 4194304,
    });
    await speech.transcribe({ bytes: wav(), mimeType: 'audio/wav' }, signal());
    expect(await voice.synthesize('你好', signal())).toMatchObject({
      mimeType: 'audio/mpeg',
      requestId: 'tts-request',
    });
    expect(String(http.mock.calls[0]?.[0])).toContain('model=nova-2&language=zh');
    expect(String(http.mock.calls[1]?.[0])).toContain('/v2/speak?model=flux-lijuan-zh');
    for (const [, options] of http.mock.calls)
      expect(options?.headers).toMatchObject({ Authorization: 'Token shared-key' });
  });
});
