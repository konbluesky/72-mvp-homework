import { randomUUID } from 'node:crypto';
import { readdir, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from '../config/index.js';
import type { AudioData } from '../providers/types.js';
import { validateAudio } from './audio-format.js';
import { LocalMediaStore, R2MediaStore, type MediaStore } from './store.js';
export { LocalMediaStore, R2MediaStore, type MediaStore } from './store.js';
export class MediaError extends Error {
  constructor(public readonly code: 'MEDIA_NOT_FOUND' | 'CAPACITY_EXCEEDED' | 'MEDIA_FAILED') {
    super(code);
    this.name = 'MediaError';
  }
}
interface Asset {
  sessionId: string;
  turnId: string;
  mimeType: string;
  expiresAt: number;
  size: number;
}
export class MediaService {
  private readonly assets = new Map<string, Asset>();
  private readonly pendingWrites = new Set<Promise<{ assetId: string; url: string }>>();
  private bytes = 0;
  private closed = false;
  constructor(
    private readonly config: Config,
    private readonly store: MediaStore,
    private readonly now: () => number = Date.now,
    private readonly id: () => string = randomUUID,
  ) {}
  async put(
    sessionId: string,
    turnId: string,
    audio: AudioData,
    signal: AbortSignal,
  ): Promise<{ assetId: string; url: string }> {
    const operation = this.persist(sessionId, turnId, audio, signal);
    this.pendingWrites.add(operation);
    try {
      return await operation;
    } finally {
      this.pendingWrites.delete(operation);
    }
  }
  private async persist(
    sessionId: string,
    turnId: string,
    audio: AudioData,
    signal: AbortSignal,
  ): Promise<{ assetId: string; url: string }> {
    signal.throwIfAborted();
    validateAudio(audio);
    if (
      this.closed ||
      audio.bytes.length > this.config.MAX_AUDIO_BYTES ||
      this.bytes + audio.bytes.length > this.config.MAX_MEDIA_BYTES
    )
      throw new MediaError('CAPACITY_EXCEEDED');
    // Reserve synchronously before writing so concurrent calls cannot overcommit capacity.
    this.bytes += audio.bytes.length;
    const assetId = this.id();
    try {
      await this.store.put(assetId, audio.bytes, audio.mimeType, signal);
      signal.throwIfAborted();
      if (this.closed) throw new MediaError('MEDIA_FAILED');
      this.assets.set(assetId, {
        sessionId,
        turnId,
        mimeType: audio.mimeType,
        expiresAt: this.now() + this.config.MEDIA_TTL_SECONDS * 1000,
        size: audio.bytes.length,
      });
      return { assetId, url: `/api/media/${assetId}` };
    } catch (error) {
      this.bytes -= audio.bytes.length;
      // A cancelled upload may have physically succeeded; remove the unpublishable object.
      await this.store.delete(assetId);
      throw error;
    }
  }
  async get(
    assetId: string,
    sessionId: string,
    signal: AbortSignal = AbortSignal.timeout(15000),
  ): Promise<AudioData> {
    const asset = this.assets.get(assetId);
    if (!asset || asset.sessionId !== sessionId || asset.expiresAt <= this.now())
      throw new MediaError('MEDIA_NOT_FOUND');
    try {
      const bytes = await this.store.get(assetId, signal);
      signal.throwIfAborted();
      if (bytes.length !== asset.size) throw new MediaError('MEDIA_FAILED');
      validateAudio({ bytes, mimeType: asset.mimeType });
      if (asset.expiresAt <= this.now() || !this.assets.has(assetId))
        throw new MediaError('MEDIA_NOT_FOUND');
      return { bytes, mimeType: asset.mimeType };
    } catch (error) {
      if (error instanceof MediaError) throw error;
      throw new MediaError('MEDIA_FAILED');
    }
  }
  async delete(assetId: string): Promise<void> {
    const asset = this.assets.get(assetId);
    if (!asset) return;
    await this.store.delete(assetId);
    if (this.assets.delete(assetId)) this.bytes -= asset.size;
  }
  async cleanup(): Promise<void> {
    const expired = [...this.assets].filter(([, value]) => value.expiresAt <= this.now());
    const results = await Promise.allSettled(expired.map(([key]) => this.delete(key)));
    if (results.some((r) => r.status === 'rejected')) throw new MediaError('MEDIA_FAILED');
  }
  async deleteTurn(sessionId: string, turnId: string): Promise<void> {
    await Promise.all(
      [...this.assets]
        .filter(([, value]) => value.sessionId === sessionId && value.turnId === turnId)
        .map(([key]) => this.delete(key)),
    );
  }
  stats() {
    return { assets: this.assets.size, bytes: this.bytes };
  }
  async close(): Promise<void> {
    this.closed = true;
    // Do not destroy an SDK client before cancelled uploads have removed their objects.
    await Promise.allSettled([...this.pendingWrites]);
    const results = await Promise.allSettled(
      [...this.assets.keys()].map((key) => this.delete(key)),
    );
    await this.store.close();
    if (results.some((r) => r.status === 'rejected')) throw new MediaError('MEDIA_FAILED');
  }
}
export function createMediaService(config: Config): MediaService {
  return new MediaService(
    config,
    config.MEDIA_STORE === 'r2'
      ? new R2MediaStore(config)
      : new LocalMediaStore(config.MEDIA_LOCAL_DIR),
  );
}
/** Purge expired orphan local files after a process restart; never follows directory symlinks. */
export async function cleanupLocalOrphans(config: Config, purgeAll = false): Promise<void> {
  if (config.MEDIA_STORE !== 'local') return;
  let files;
  try {
    files = await readdir(config.MEDIA_LOCAL_DIR, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  for (const file of files) {
    if (!file.isFile() || !/^[0-9a-f-]{36}$/.test(file.name)) continue;
    const path = join(config.MEDIA_LOCAL_DIR, file.name);
    const info = await stat(path);
    if (purgeAll || Date.now() - info.mtimeMs > config.MEDIA_TTL_SECONDS * 1000)
      await rm(path, { force: true });
  }
}
