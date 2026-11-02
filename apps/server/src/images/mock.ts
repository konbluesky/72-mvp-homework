import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Config } from '../config/index.js';
import { ImageGenerationError, type ImageProvider, type ImageRecipe } from './types.js';
/** Explicitly simulated: reuse the scene's existing background, never claim a real photograph. */
export class MockImageProvider implements ImageProvider {
  readonly simulated = true;
  constructor(
    private readonly config: Config,
    private readonly path: string,
  ) {}
  async generate(
    _recipe: ImageRecipe,
    _correlation: string,
    signal: AbortSignal,
    update: (state: 'running' | 'submit_unknown') => void,
    attempt = 1,
  ) {
    update('running');
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, this.config.MOCK_IMAGE_DELAY_MS);
      timer.unref();
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
    if (
      this.config.MOCK_IMAGE_FAILURE === 'always' ||
      (this.config.MOCK_IMAGE_FAILURE === 'first' && attempt === 1)
    )
      throw new ImageGenerationError('generation_failed');
    const bytes = await readFile(
      fileURLToPath(new URL(`../../../../${this.path}`, import.meta.url)),
      { signal },
    );
    return { bytes, mimeType: 'image/png' as const };
  }
}
