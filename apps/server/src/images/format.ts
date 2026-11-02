import { spawn } from 'node:child_process';
import type { GeneratedImage } from './types.js';
import { ImageGenerationError } from './types.js';
/** Decode in a bounded subprocess and strip metadata; only a canonical single-frame PNG is stored. */
export async function validateImage(
  bytes: Uint8Array,
  maximum: number,
  ffmpeg: string,
  signal: AbortSignal,
): Promise<GeneratedImage & { width: number; height: number }> {
  if (!bytes.length || bytes.length > maximum) throw new ImageGenerationError('invalid_image');
  const b = Buffer.from(bytes);
  const png = b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = b[0] === 255 && b[1] === 216 && b[2] === 255;
  const webp = b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
  if (!png && !jpeg && !webp) throw new ImageGenerationError('invalid_image');
  const result = await new Promise<Buffer>((resolve, reject) => {
    const child = spawn(
      ffmpeg,
      [
        '-v',
        'error',
        '-max_alloc',
        '67108864',
        '-max_pixels',
        '16777216',
        '-i',
        'pipe:0',
        '-frames:v',
        '1',
        '-vf',
        "scale=w='min(2048,iw)':h='min(2048,ih)':force_original_aspect_ratio=decrease",
        '-map_metadata',
        '-1',
        '-threads',
        '1',
        '-f',
        'image2pipe',
        '-c:v',
        'png',
        'pipe:1',
      ],
      { stdio: ['pipe', 'pipe', 'ignore'] },
    );
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error) {
        child.kill('SIGKILL');
        reject(error);
      } else resolve(Buffer.concat(chunks, size));
    };
    const abort = () => finish(new ImageGenerationError('invalid_image'));
    const timer = setTimeout(abort, 15000);
    timer.unref();
    signal.addEventListener('abort', abort, { once: true });
    child.on('error', abort);
    child.stdin.on('error', () => undefined);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maximum) abort();
      else chunks.push(chunk);
    });
    child.on('close', (code) =>
      finish(code === 0 ? undefined : new ImageGenerationError('invalid_image')),
    );
    if (signal.aborted) abort();
    else child.stdin.end(bytes);
  });
  signal.throwIfAborted();
  if (result.length < 24) throw new ImageGenerationError('invalid_image');
  const width = result.readUInt32BE(16),
    height = result.readUInt32BE(20);
  if (width < 64 || height < 64 || width > 2048 || height > 2048)
    throw new ImageGenerationError('invalid_image');
  return { bytes: result, mimeType: 'image/png', width, height };
}
