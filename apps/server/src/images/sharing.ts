import type { Config } from '../config/index.js';
import type { MediaService } from '../media/index.js';
import type { Session, SessionManager } from '../sessions/manager.js';
import { validateImage } from './format.js';
import { ImageGenerationError, type ImageProvider, type ImageWork } from './types.js';
/** Independent of chat/TTS deadlines. The manager is the only state writer. */
export class ImageSharingService {
  private queue: Array<{ session: Session; work: ImageWork; attemptId: string }> = [];
  private active = 0;
  private tasks = new Set<Promise<void>>();
  private pending = new Map<ImageWork, string>();
  private closed = false;
  constructor(
    private readonly config: Config,
    private readonly sessions: SessionManager,
    private readonly media: MediaService,
    readonly provider?: ImageProvider,
  ) {
    sessions.imageLifecycle = {
      start: (session, work) => this.start(session, work),
      removed: (session) => {
        this.track(media.deleteSession(session.id));
      },
      discard: (work) => {
        if (work.share.assetId) this.track(media.delete(work.share.assetId));
      },
      assetAvailable: (id, sessionId) => media.available(id, sessionId, 15000),
    };
  }
  private track(task: Promise<void>) {
    this.tasks.add(task);
    void task.catch(() => undefined).finally(() => this.tasks.delete(task));
  }
  private start(session: Session, work: ImageWork): void {
    const attemptId = work.share.attemptId;
    if (this.closed || this.pending.get(work) === attemptId) return;
    if (!this.provider || this.queue.length >= this.config.IMAGE_MAX_QUEUED) {
      this.sessions.updateImage(
        session,
        work,
        attemptId,
        { phase: 'failed', reason: 'generation_failed' },
        'failed',
      );
      return;
    }
    this.pending.set(work, attemptId);
    this.queue.push({ session, work, attemptId });
    this.drain();
  }
  private drain() {
    while (!this.closed && this.active < this.config.IMAGE_MAX_ACTIVE && this.queue.length) {
      const entry = this.queue.shift()!;
      if (entry.work.share.attemptId !== entry.attemptId || entry.work.abort.signal.aborted) {
        if (this.pending.get(entry.work) === entry.attemptId) this.pending.delete(entry.work);
        continue;
      }
      this.active++;
      const task = this.run(entry.session, entry.work, entry.attemptId).finally(() => {
        this.active--;
        if (this.pending.get(entry.work) === entry.attemptId) this.pending.delete(entry.work);
        this.drain();
      });
      this.track(task);
    }
  }
  private async run(session: Session, work: ImageWork, attemptId: string): Promise<void> {
    const deadline = AbortSignal.timeout(Math.max(1, work.share.expiresAt - Date.now()));
    const signal = AbortSignal.any([work.abort.signal, deadline]);
    let assetId: string | undefined;
    try {
      if (!this.sessions.updateImage(session, work, attemptId, {}, 'running')) return;
      const image = await this.provider!.generate(
        work.recipe,
        `${session.id}_${attemptId}`,
        signal,
        (state) => {
          if (work.work !== state)
            this.sessions.updateImage(
              session,
              work,
              attemptId,
              { phase: state === 'submit_unknown' ? 'submit_unknown' : 'preparing' },
              state,
            );
        },
        work.attemptCount,
      );
      signal.throwIfAborted();
      const checked = await validateImage(
        image.bytes,
        this.config.MAX_IMAGE_BYTES,
        this.config.FFMPEG_PATH,
        signal,
      );
      const stored = await this.media.putImage(session.id, work.share.shareId, checked, signal);
      assetId = stored.assetId;
      if (
        !this.sessions.updateImage(
          session,
          work,
          attemptId,
          {
            phase: 'ready',
            assetId,
            width: checked.width,
            height: checked.height,
            expiresAt: Date.now() + this.config.IMAGE_ASSET_TTL_SECONDS * 1000,
          },
          'ready',
        )
      )
        await this.media.delete(assetId);
    } catch (error) {
      if (assetId) await this.media.delete(assetId).catch(() => undefined);
      if (deadline.aborted && !work.abort.signal.aborted)
        this.sessions.endImage(session, work, 'expired');
      else if (!work.abort.signal.aborted)
        this.sessions.updateImage(
          session,
          work,
          attemptId,
          {
            phase: 'failed',
            reason: error instanceof ImageGenerationError ? error.reason : 'generation_failed',
          },
          'failed',
        );
    }
  }
  async close() {
    this.closed = true;
    this.queue = [];
    for (const work of this.pending.keys()) work.abort.abort();
    await Promise.allSettled([...this.tasks]);
    this.pending.clear();
  }
}
