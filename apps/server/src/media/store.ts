import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import type { Config } from '../config/index.js';

export interface MediaStore {
  put(key: string, bytes: Uint8Array, mimeType: string, signal: AbortSignal): Promise<void>;
  get(key: string, signal: AbortSignal): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  close(): Promise<void>;
}
function objectKey(key: string): string {
  return `${key.startsWith('i_') ? 'private-images' : 'private-audio'}/${safeKey(key)}`;
}
function safeKey(key: string): string {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(key)) throw new Error('Invalid media key');
  return key;
}
export class LocalMediaStore implements MediaStore {
  constructor(private readonly directory: string) {}
  async put(key: string, bytes: Uint8Array, _mimeType: string, signal: AbortSignal) {
    signal.throwIfAborted();
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFile(join(this.directory, safeKey(key)), bytes, { signal, mode: 0o600, flag: 'wx' });
  }
  async get(key: string, signal: AbortSignal) {
    return readFile(join(this.directory, safeKey(key)), { signal });
  }
  async delete(key: string) {
    await rm(join(this.directory, safeKey(key)), { force: true });
  }
  async close() {
    /* No open handles; MediaService owns deletion of its catalog. */
  }
}
export class R2MediaStore implements MediaStore {
  private readonly client: S3Client;
  constructor(
    private readonly config: Config,
    client?: S3Client,
  ) {
    this.client =
      client ??
      new S3Client({
        endpoint: config.R2_ENDPOINT,
        region: config.R2_REGION,
        credentials: {
          accessKeyId: config.R2_ACCESS_KEY_ID,
          secretAccessKey: config.R2_SECRET_ACCESS_KEY,
        },
        maxAttempts: 1,
      });
  }
  async put(key: string, bytes: Uint8Array, mimeType: string, signal: AbortSignal) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.R2_BUCKET,
        Key: objectKey(key),
        Body: bytes,
        ContentType: mimeType,
        CacheControl: 'private, no-store',
      }),
      { abortSignal: signal },
    );
  }
  async get(key: string, signal: AbortSignal) {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.R2_BUCKET, Key: objectKey(key) }),
      { abortSignal: signal },
    );
    if (
      !result.Body ||
      (result.ContentLength ?? 0) >
        (key.startsWith('i_') ? this.config.MAX_IMAGE_BYTES : this.config.MAX_AUDIO_BYTES)
    ) {
      if (result.Body) await result.Body.transformToWebStream().cancel();
      throw new Error('Invalid stored audio');
    }
    const reader = result.Body.transformToWebStream().getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    const onAbort = () => {
      void reader.cancel().catch(() => undefined);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      for (;;) {
        signal.throwIfAborted();
        const { value, done } = await reader.read();
        signal.throwIfAborted();
        if (done) break;
        length += value.length;
        if (
          length >
          (key.startsWith('i_') ? this.config.MAX_IMAGE_BYTES : this.config.MAX_AUDIO_BYTES)
        ) {
          await reader.cancel();
          throw new Error('Stored audio is too large');
        }
        chunks.push(value);
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
      reader.releaseLock();
    }
    return Buffer.concat(chunks, length);
  }
  async delete(key: string) {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.R2_BUCKET,
        Key: objectKey(key),
      }),
      { abortSignal: AbortSignal.timeout(5000) },
    );
  }
  async close() {
    this.client.destroy();
  }
}
