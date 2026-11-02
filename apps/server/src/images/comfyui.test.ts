import { describe, expect, it, vi } from 'vitest';
import { ComfyImageProvider } from './comfyui.js';
import { testConfig } from '../../test/helpers.js';
import type { ImageRecipe } from './types.js';
const recipe: ImageRecipe = {
  slotKey: 'test',
  originLabel: 'test',
  title: 'test',
  character: 'adult',
  appearance: 'coat',
  location: 'room',
  environment: 'room',
  positive: 'test',
  negative: 'test',
  width: 1024,
  height: 1024,
  introduction: 'test',
  readyLine: 'test',
  intent: { focus: 'character', mood: 'warm', framing: 'portrait' },
  seed: 1,
};
describe('native ComfyUI transport', () => {
  it('reconciles ambiguous POST on the original queue without ever posting twice', async () => {
    let posts = 0;
    const fetcher = vi.fn(async (url: URL | string | Request, _init?: RequestInit) => {
      const u = new URL(String(url));
      if (u.pathname === '/prompt') {
        posts++;
        throw new Error('response-lost');
      }
      if (u.pathname === '/queue')
        return Response.json({
          queue_running: [[0, 'prompt-1', {}, { image_share_correlation: 'correlation' }]],
          queue_pending: [],
        });
      if (u.pathname === '/history/prompt-1')
        return Response.json({
          'prompt-1': {
            status: { completed: true, status_str: 'success' },
            outputs: { '17': { images: [{ filename: 'one.png', subfolder: '', type: 'output' }] } },
          },
        });
      if (u.pathname === '/view')
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'Content-Type': 'image/png' },
        });
      throw new Error('unexpected-route');
    });
    const update = vi.fn();
    const provider = new ComfyImageProvider(testConfig(), fetcher as typeof fetch);
    await provider.generate(recipe, 'correlation', AbortSignal.timeout(5000), update);
    expect(posts).toBe(1);
    expect(update).toHaveBeenCalledWith('submit_unknown');
    expect(update).toHaveBeenCalledWith('running');
  });
  it('uses configured S3 object origin for the source filename/subfolder contract, with no node credentials', async () => {
    const fetcher = vi.fn(async (url: URL | string | Request, init?: RequestInit) => {
      const u = new URL(String(url));
      if (u.pathname === '/prompt') return Response.json({ prompt_id: 'p' });
      if (u.pathname === '/history/p')
        return Response.json({
          p: {
            outputs: {
              '17': { images: [{ filename: 'one.png', subfolder: 'private', type: 'output' }] },
            },
            status: { completed: true, status_str: 'success' },
          },
        });
      expect(u.origin).toBe('https://images.example');
      expect(u.pathname).toBe('/private/one.png');
      expect(init?.headers).toEqual({});
      return new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'image/png' } });
    });
    const provider = new ComfyImageProvider(
      testConfig({
        COMFYUI_OUTPUT: 's3',
        COMFYUI_S3_ORIGIN: 'https://images.example',
        COMFYUI_HEADERS_JSON: '{"Authorization":"private"}',
      }),
      fetcher as typeof fetch,
    );
    await provider.generate(recipe, 'c', AbortSignal.timeout(5000), () => undefined);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('never follows an arbitrary provider output URL to another origin', async () => {
    const fetcher = vi.fn(async (url: URL | string | Request) =>
      new URL(String(url)).pathname === '/prompt'
        ? Response.json({ prompt_id: 'p' })
        : Response.json({
            p: {
              outputs: { '17': { urls: ['https://untrusted.example/private'] } },
              status: { completed: true },
            },
          }),
    );
    const provider = new ComfyImageProvider(
      testConfig({ COMFYUI_OUTPUT: 's3', COMFYUI_S3_ORIGIN: 'https://images.example' }),
      fetcher as typeof fetch,
    );
    await expect(
      provider.generate(recipe, 'c', AbortSignal.timeout(5000), () => undefined),
    ).rejects.toThrow('invalid_image');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
