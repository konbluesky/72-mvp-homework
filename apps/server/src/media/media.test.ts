import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { toneWav } from '../../../../tests/fixtures/audio.js';
import { loadConfig } from '../config/index.js';
import { MediaService, LocalMediaStore, R2MediaStore, type MediaStore } from './index.js';
const signal = () => new AbortController().signal;
async function audio() {
  return {
    bytes: toneWav(),
    mimeType: 'audio/wav',
  };
}

describe('private media lifecycle', () => {
  it('local media enforces ownership, expiry, deletion and path-safe keys', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mira-media-'));
    let now = 1000;
    const config = loadConfig({ MEDIA_LOCAL_DIR: directory, MEDIA_TTL_SECONDS: '1' });
    const store = new LocalMediaStore(directory);
    const media = new MediaService(
      config,
      store,
      () => now,
      () => 'asset-1',
    );
    try {
      const result = await media.put('session-a', 'turn-a', await audio(), signal());
      expect(result.url).toBe('/api/media/asset-1');
      await expect(media.get(result.assetId, 'session-b')).rejects.toMatchObject({
        code: 'MEDIA_NOT_FOUND',
      });
      expect((await media.get(result.assetId, 'session-a')).bytes.length).toBeGreaterThan(1000);
      await expect(store.get('../secrets', signal())).rejects.toThrow('Invalid media key');
      now = 2001;
      await expect(media.get(result.assetId, 'session-a')).rejects.toMatchObject({
        code: 'MEDIA_NOT_FOUND',
      });
      await media.cleanup();
      expect(media.stats()).toEqual({ assets: 0, bytes: 0 });
      await expect(readFile(join(directory, 'asset-1'))).rejects.toThrow();
    } finally {
      await media.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('reserves capacity before async put and deletes cancelled unpublished objects', async () => {
    const value = await audio();
    let resolve!: () => void;
    const pending = new Promise<void>((r) => {
      resolve = r;
    });
    const store: MediaStore = {
      put: vi.fn(() => pending),
      get: vi.fn(async () => value.bytes),
      delete: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const config = loadConfig({ MAX_MEDIA_BYTES: String(value.bytes.length) });
    const media = new MediaService(config, store, Date.now, () => 'asset-cancel');
    const controller = new AbortController();
    const first = media.put('s', 't', value, controller.signal);
    await expect(media.put('s', 't2', value, signal())).rejects.toMatchObject({
      code: 'CAPACITY_EXCEEDED',
    });
    controller.abort();
    resolve();
    await expect(first).rejects.toThrow();
    expect(store.delete).toHaveBeenCalledWith('asset-cancel');
    expect(media.stats()).toEqual({ assets: 0, bytes: 0 });
    await media.close();
  });
  it('shutdown waits for pending upload cleanup before closing the store', async () => {
    const value = await audio();
    let finish!: () => void;
    const events: string[] = [];
    const store: MediaStore = {
      put: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      get: async () => value.bytes,
      delete: async () => {
        events.push('delete');
      },
      close: async () => {
        events.push('close');
      },
    };
    const media = new MediaService(loadConfig({}), store);
    const upload = media.put('s', 't', value, signal());
    const shutdown = media.close();
    expect(events).toEqual([]);
    finish();
    await expect(upload).rejects.toMatchObject({ code: 'MEDIA_FAILED' });
    await shutdown;
    expect(events).toEqual(['delete', 'close']);
  });
  it('R2 issues private S3 commands and propagates cancellation', async () => {
    const client = new S3Client({
      region: 'auto',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    const send = vi.spyOn(client, 'send').mockImplementation(async () => ({}));
    const store = new R2MediaStore(loadConfig({ R2_BUCKET: 'private-demo' }), client);
    const abortSignal = signal();
    const value = await audio();
    await store.put('asset1', value.bytes, value.mimeType, abortSignal);
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    if (command instanceof PutObjectCommand)
      expect(command.input).toMatchObject({
        Bucket: 'private-demo',
        Key: 'private-audio/asset1',
        CacheControl: 'private, no-store',
        ContentType: 'audio/wav',
      });
    expect(send.mock.calls[0]?.[1]).toMatchObject({ abortSignal });
    const body = Object.assign(Readable.from([value.bytes]), {
      transformToByteArray: async () => value.bytes,
      transformToString: async () => '',
      transformToWebStream: () => Readable.toWeb(body),
    });
    send.mockImplementationOnce(async () => ({ Body: body, ContentLength: value.bytes.length }));
    expect([...(await store.get('asset1', abortSignal))]).toEqual([...value.bytes]);
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(GetObjectCommand);
    await store.delete('asset1');
    expect(send.mock.calls[2]?.[0]).toBeInstanceOf(DeleteObjectCommand);
    await store.close();
  });
});
