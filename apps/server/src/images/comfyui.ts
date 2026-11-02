import { z } from 'zod';
import api from './workflow/api.json' with { type: 'json' };
import params from './workflow/params.json' with { type: 'json' };
import type { Config } from '../config/index.js';
import { imagePrompts } from './prompt.js';
import {
  ImageGenerationError,
  type ImageProvider,
  type ImageRecipe,
  type GeneratedImage,
} from './types.js';
const object = z.record(z.string(), z.unknown());
const promptId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(done, ms);
    timer.unref();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
export async function boundedBytes(
  response: Response,
  maximum: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length')) > maximum) {
    await response.body?.cancel();
    throw new ImageGenerationError('invalid_image');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ImageGenerationError('generation_failed');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum) throw new ImageGenerationError('invalid_image');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}
/** Native ComfyUI only. A POST is never retried, including an ambiguous timeout. */
export class ComfyImageProvider implements ImageProvider {
  readonly simulated = false;
  constructor(
    private readonly config: Config,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  private headers() {
    return Object.fromEntries(
      Object.entries(this.config.COMFYUI_HEADERS_JSON).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  }
  private async json(path: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
    const combined = AbortSignal.any([
      signal,
      AbortSignal.timeout(this.config.IMAGE_REQUEST_TIMEOUT_MS),
    ]);
    const response = await this.fetcher(new URL(path, this.config.COMFYUI_BASE_URL), {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...this.headers(),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: combined,
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (body !== undefined && response.status >= 400 && response.status < 500)
        throw new ImageGenerationError('generation_failed');
      throw new Error('COMFY_REQUEST_UNCONFIRMED');
    }
    return JSON.parse(
      new TextDecoder().decode(await boundedBytes(response, 4 * 1024 * 1024, combined)),
    );
  }
  async generate(
    recipe: ImageRecipe,
    correlationId: string,
    signal: AbortSignal,
    update: (state: 'running' | 'submit_unknown') => void,
  ): Promise<GeneratedImage> {
    const graph = structuredClone(api);
    const b = params.bindings;
    const prompts = imagePrompts(recipe);
    graph[b.positive as '12'].inputs.text = prompts.positive;
    graph['13'].inputs.text = prompts.negative;
    graph['5'].inputs.seed = recipe.seed;
    graph['6'].inputs.width = recipe.width;
    graph['6'].inputs.height = recipe.height;
    graph['18'].inputs.ckpt_name = this.config.COMFYUI_CHECKPOINT;
    graph['17'].class_type = this.config.COMFYUI_OUTPUT === 'view' ? 'SaveImage' : 'SaveImageS3';
    graph['17'].inputs.filename_prefix = `image-share-${correlationId}`;
    let id: string | undefined;
    try {
      const result = object.parse(
        await this.json('prompt', signal, {
          prompt: graph,
          client_id: correlationId,
          extra_data: { image_share_correlation: correlationId },
        }),
      );
      id = promptId.parse(result.prompt_id);
      update('running');
    } catch (error) {
      if (error instanceof ImageGenerationError) throw error;
      if (signal.aborted) throw error;
      update('submit_unknown');
    }
    while (!signal.aborted) {
      try {
        if (!id) id = await this.reconcile(correlationId, signal);
        if (id) {
          update('running');
          const history = object.parse(
            await this.json(`history/${encodeURIComponent(id)}`, signal),
          );
          const item = object.safeParse(history[id]);
          if (item.success) {
            const status = object.safeParse(item.data.status);
            if (status.success && status.data.status_str === 'error')
              throw new ImageGenerationError('generation_failed');
            const outputs = object.safeParse(item.data.outputs);
            if (outputs.success && Object.keys(outputs.data).length)
              return await this.readOutput(outputs.data, signal);
            if (status.success && status.data.completed === true)
              throw new ImageGenerationError('generation_failed');
          }
        }
      } catch (error) {
        if (error instanceof ImageGenerationError)
          throw error; /* Read failures retain the job; the independent deadline is final. */
      }
      await pause(this.config.IMAGE_POLL_MS, signal);
    }
    throw new ImageGenerationError('deadline');
  }
  private async reconcile(correlation: string, signal: AbortSignal): Promise<string | undefined> {
    const queue = object.parse(await this.json('queue', signal));
    for (const key of ['queue_running', 'queue_pending'])
      if (Array.isArray(queue[key]))
        for (const row of queue[key])
          if (
            Array.isArray(row) &&
            object.safeParse(row[3]).success &&
            object.parse(row[3]).image_share_correlation === correlation
          ) {
            const parsed = promptId.safeParse(row[1]);
            if (parsed.success) return parsed.data;
          }
    const history = object.parse(await this.json('history?max_items=200', signal));
    for (const [id, item] of Object.entries(history)) {
      const parsed = object.safeParse(item);
      const prompt = parsed.success ? parsed.data.prompt : undefined;
      if (
        Array.isArray(prompt) &&
        object.safeParse(prompt[3]).success &&
        object.parse(prompt[3]).image_share_correlation === correlation &&
        promptId.safeParse(id).success
      )
        return id;
    }
    return undefined;
  }
  private async readOutput(
    outputs: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<GeneratedImage> {
    const out = object.parse(outputs[params.bindings.output]);
    let url: URL;
    if (this.config.COMFYUI_OUTPUT === 'view') {
      const image = z
        .array(
          z
            .object({
              filename: z.string().min(1).max(250),
              subfolder: z.string().max(250),
              type: z.literal('output'),
            })
            .passthrough(),
        )
        .min(1)
        .max(4)
        .parse(out.images)[0]!;
      if (
        /[\\/]/.test(image.filename) ||
        image.subfolder.split(/[\\/]/).some((part) => part === '..')
      )
        throw new ImageGenerationError('invalid_image');
      url = new URL('view', this.config.COMFYUI_BASE_URL);
      url.search = new URLSearchParams({
        filename: image.filename,
        subfolder: image.subfolder,
        type: image.type,
      }).toString();
    } else {
      // The source SaveImageS3 returns object keys as filename/subfolder, never /view.
      const files = z
        .array(
          z
            .object({
              filename: z.string().min(1).max(500),
              subfolder: z.string().max(500).optional(),
            })
            .passthrough(),
        )
        .safeParse(out.images);
      const images = z.array(z.object({ url: z.string() }).passthrough()).safeParse(out.images);
      const urls = z.array(z.string()).safeParse(out.urls);
      const file = files.success ? files.data[0] : undefined;
      if (file) {
        const parts = [file.subfolder ?? '', file.filename]
          .flatMap((part) => part.split('/'))
          .filter(Boolean);
        if (
          !parts.length ||
          parts.some((part) => part === '..' || part === '.' || /[\\?#%:\x00-\x1f]/.test(part))
        )
          throw new ImageGenerationError('invalid_image');
        url = new URL('/' + parts.map(encodeURIComponent).join('/'), this.config.COMFYUI_S3_ORIGIN);
      } else {
        const raw = images.success ? images.data[0]?.url : urls.success ? urls.data[0] : undefined;
        if (!raw) throw new ImageGenerationError('invalid_image');
        url = new URL(raw);
      }
      if (
        url.origin !== this.config.COMFYUI_S3_ORIGIN ||
        url.username ||
        url.password ||
        url.protocol !== 'https:'
      )
        throw new ImageGenerationError('invalid_image');
    }
    const combined = AbortSignal.any([
      signal,
      AbortSignal.timeout(this.config.IMAGE_REQUEST_TIMEOUT_MS),
    ]);
    const response = await this.fetcher(url, {
      headers: url.origin === new URL(this.config.COMFYUI_BASE_URL).origin ? this.headers() : {},
      signal: combined,
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ImageGenerationError('generation_failed');
    }
    const bytes = await boundedBytes(response, this.config.MAX_IMAGE_BYTES, combined);
    return {
      bytes,
      mimeType: response.headers.get('content-type') === 'image/jpeg' ? 'image/jpeg' : 'image/png',
    };
  }
}
