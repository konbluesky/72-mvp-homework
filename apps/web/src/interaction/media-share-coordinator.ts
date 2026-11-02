import type { ImagePendingPayload, ImageReadyPayload, ImageShare } from '@mira/protocol';
import { ApiClient, ApiError } from '../api/client.js';
import type { InteractiveState } from './state.js';
import { mergeImageShare, type ImageShareView } from './conversation-items.js';
import { abortable } from '../playback/abortable.js';
const frame = (signal: AbortSignal) =>
  abortable(new Promise<void>((resolve) => requestAnimationFrame(() => resolve())), signal);
/** Polls state only. First presentation is always requested through Controller + Scheduler. */
export class MediaShareCoordinator {
  private appearance?: string;
  private epoch = 0;
  private sessionId = '';
  private timer?: ReturnType<typeof setTimeout>;
  private flight = false;
  private abort = new AbortController();
  private errors = 0;
  private revision = 0;
  private userActivityRevision = 0;
  private activityUntil = 0;
  private heldInputs = new Set<string>();
  private pointerDown = (event: PointerEvent) => {
    this.heldInputs.add(`pointer-${event.pointerId}`);
    this.inputChanged();
  };
  private pointerUp = (event: PointerEvent) => {
    this.heldInputs.delete(`pointer-${event.pointerId}`);
    this.activityUntil = Date.now() + 1200;
    this.wasIdle = false;
  };
  private keyDown = (event: KeyboardEvent) => {
    this.heldInputs.add(`key-${event.code || event.key}`);
    this.inputChanged();
  };
  private keyUp = (event: KeyboardEvent) => {
    this.heldInputs.delete(`key-${event.code || event.key}`);
    this.activityUntil = Date.now() + 1200;
    this.wasIdle = false;
  };
  private releaseInputs = () => {
    this.heldInputs.clear();
    this.activityUntil = Date.now() + 1200;
    this.wasIdle = false;
  };
  private gates = {
    composing: false,
    draft: false,
    reading: false,
    modal: false,
    appearance: true,
  };
  private idleCycle = 0;
  private wasIdle = false;
  private attempted = new Map<string, string>();
  private prepared = new Map<string, { url: string; version: number }>();
  private nodes = new Map<string, Set<HTMLElement>>();
  private urls = new Set<string>();
  constructor(
    private readonly api: ApiClient,
    private readonly state: InteractiveState,
    private readonly deliver: (share: ImageShareView, revision: number) => Promise<boolean>,
    private readonly interrupt: () => void,
  ) {
    document.addEventListener('pointerdown', this.pointerDown, true);
    document.addEventListener('pointerup', this.pointerUp, true);
    document.addEventListener('pointercancel', this.pointerUp, true);
    document.addEventListener('keydown', this.keyDown, true);
    document.addEventListener('keyup', this.keyUp, true);
    window.addEventListener('blur', this.releaseInputs);
    this.schedule(500);
  }
  setSession(id: string, shares: ImageShare[] = []) {
    if (id !== this.sessionId) {
      this.epoch++;
      this.abort.abort();
      this.abort = new AbortController();
      this.sessionId = id;
      this.errors = 0;
      this.attempted.clear();
      this.state.imageShares = {};
      this.state.imageItems = [];
      this.prepared.clear();
      for (const url of this.urls) URL.revokeObjectURL(url);
      this.urls.clear();
    }
    for (const share of shares) this.merge(share);
  }
  setAppearance(profile: string) {
    if (this.appearance && this.appearance !== profile) {
      this.inputChanged();
      for (const share of Object.values(this.state.imageShares))
        if (!['cancelled', 'expired', 'presented'].includes(share.phase))
          void this.cancel(share.shareId);
    }
    this.appearance = profile;
  }
  gate(update: Partial<typeof this.gates>) {
    const changed = Object.entries(update).some(
      ([key, value]) => this.gates[key as keyof typeof this.gates] !== value,
    );
    Object.assign(this.gates, update);
    if (changed) {
      this.wasIdle = false;
      this.revision++;
      if (
        update.composing ||
        update.draft ||
        update.reading ||
        update.modal ||
        update.appearance === false
      )
        this.interrupt();
    }
  }
  inputChanged() {
    this.userActivityRevision++;
    this.wasIdle = false;
    this.activityUntil = Date.now() + 1200;
    this.revision++;
    this.interrupt();
  }
  get inputRevision() {
    return this.revision;
  }
  private patch(id: string, patch: Partial<ImageShareView>) {
    const old = this.state.imageShares[id];
    if (old) this.state.imageShares = { ...this.state.imageShares, [id]: { ...old, ...patch } };
  }
  private requestFailed(id: string, error: unknown) {
    if (
      error instanceof ApiError &&
      ['SESSION_EXPIRED', 'UNAUTHORIZED', 'MEDIA_NOT_FOUND'].includes(error.code)
    )
      this.patch(id, {
        phase: 'expired',
        reason: 'session_ended',
        networkError: false,
        cancelRequested: false,
        display: 'placeholder',
        url: undefined,
      });
    else this.patch(id, { networkError: true });
  }
  private merge(share: ImageShare) {
    const next = mergeImageShare(this.state.imageShares[share.shareId], share);
    if (!next) return;
    this.state.imageShares = { ...this.state.imageShares, [share.shareId]: next };
    if (!this.state.imageItems.some((item) => item.shareId === share.shareId))
      this.state.imageItems = [
        ...this.state.imageItems,
        { kind: 'image-share', shareId: share.shareId, anchorId: this.state.activeMessageId },
      ];
  }
  register(id: string, node: HTMLElement | null, previous?: HTMLElement | null) {
    const nodes = this.nodes.get(id) ?? new Set<HTMLElement>();
    if (previous) nodes.delete(previous);
    if (node) nodes.add(node);
    if (nodes.size) this.nodes.set(id, nodes);
    else this.nodes.delete(id);
  }
  private visibleNode(id: string): HTMLElement | undefined {
    if (document.hidden) return;
    return [...(this.nodes.get(id) ?? [])].find((node) => {
      if (!node.isConnected || node.closest('dialog:not([open])')) return false;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= innerHeight)
        return false;
      const parent = node.closest<HTMLElement>('[role="log"],.history-lines,.story-dialog-body');
      if (parent) {
        const p = parent.getBoundingClientRect();
        if (rect.bottom <= p.top || rect.top >= p.bottom) return false;
      }
      return true;
    });
  }
  private visiblePreview(id: string): boolean {
    const node = this.visibleNode(id);
    const preview = node?.querySelector<HTMLElement>('.image-share-preview');
    if (!node || !preview) return false;
    const rect = preview.getBoundingClientRect();
    const viewport = node
      .closest<HTMLElement>('[role="log"],.history-lines,.story-dialog-body')
      ?.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.top < innerHeight &&
      (!viewport || (rect.bottom > viewport.top && rect.top < viewport.bottom))
    );
  }
  private async revealPreview(id: string): Promise<void> {
    const node = this.visibleNode(id);
    const preview = node?.querySelector<HTMLElement>('.image-share-preview');
    const pane = node?.closest<HTMLElement>('[role="log"],.history-lines,.story-dialog-body');
    if (!preview || !pane) return;
    const rect = preview.getBoundingClientRect(),
      viewport = pane.getBoundingClientRect();
    if (rect.top < viewport.top || rect.bottom > viewport.bottom) {
      pane.scrollTop +=
        rect.top - viewport.top - Math.max(0, (pane.clientHeight - rect.height) / 2);
      // Scroll handlers must settle before the new media lease captures inputRevision.
      await frame(this.abort.signal);
      await frame(this.abort.signal);
    }
  }
  async pending(payload: ImagePendingPayload, signal: AbortSignal): Promise<void> {
    this.merge(payload.share);
    const epoch = this.epoch;
    try {
      await this.draw(payload.share.shareId, signal);
      signal.throwIfAborted();
      if (epoch !== this.epoch) throw new Error('STALE_IMAGE');
    } catch (error) {
      if (epoch === this.epoch) {
        const shares = { ...this.state.imageShares };
        delete shares[payload.share.shareId];
        this.state.imageShares = shares;
        this.state.imageItems = this.state.imageItems.filter(
          (item) => item.shareId !== payload.share.shareId,
        );
      }
      throw error;
    }
  }
  private async draw(id: string, signal: AbortSignal) {
    const until = Date.now() + 10000;
    while (Date.now() < until) {
      await frame(signal);
      if (this.visibleNode(id)) {
        await frame(signal);
        if (this.visibleNode(id)) return;
      }
    }
    throw new Error('IMAGE_NOT_VISIBLE');
  }
  async prepare(payload: ImageReadyPayload, signal: AbortSignal): Promise<void> {
    const old = this.state.imageShares[payload.shareId];
    if (
      !old ||
      old.cancelRequested ||
      old.collapsed ||
      ['cancelled', 'expired'].includes(old.phase) ||
      payload.version < old.version
    )
      throw new Error('STALE_IMAGE');
    const epoch = this.epoch;
    this.patch(payload.shareId, { display: 'loading' });
    let url: string | undefined;
    try {
      const blob = await this.api.image(`/api/media/${payload.assetId}`, signal);
      signal.throwIfAborted();
      url = URL.createObjectURL(blob);
      this.urls.add(url);
      const image = new Image();
      image.src = url;
      await abortable(image.decode(), signal);
      if (!image.naturalWidth || !image.naturalHeight || epoch !== this.epoch)
        throw new Error('INVALID_IMAGE');
      signal.throwIfAborted();
      const entry = { url, version: payload.version };
      this.prepared.set(payload.shareId, entry);
      signal.addEventListener(
        'abort',
        () => {
          if (this.prepared.get(payload.shareId) === entry) {
            this.prepared.delete(payload.shareId);
            URL.revokeObjectURL(entry.url);
            this.urls.delete(entry.url);
            if (epoch === this.epoch) this.patch(payload.shareId, { display: 'placeholder' });
          }
        },
        { once: true },
      );
    } catch (error) {
      if (epoch === this.epoch)
        this.patch(payload.shareId, { display: signal.aborted ? 'placeholder' : 'load_failed' });
      if (url) {
        URL.revokeObjectURL(url);
        this.urls.delete(url);
      }
      throw error;
    }
  }
  async ready(payload: ImageReadyPayload, signal: AbortSignal): Promise<void> {
    const epoch = this.epoch;
    const entry = this.prepared.get(payload.shareId);
    const current = this.state.imageShares[payload.shareId];
    if (
      !entry ||
      entry.version !== payload.version ||
      !current ||
      current.collapsed ||
      current.cancelRequested ||
      ['cancelled', 'expired'].includes(current.phase)
    )
      throw new Error('STALE_IMAGE');
    try {
      signal.throwIfAborted();
      this.patch(payload.shareId, { url: entry.url, display: 'presented' });
      await this.draw(payload.shareId, signal);
      const node = this.visibleNode(payload.shareId);
      const mounted = node?.querySelector<HTMLImageElement>('.image-share-preview img');
      if (
        !mounted ||
        this.state.imageShares[payload.shareId]?.collapsed ||
        !node ||
        node.classList.contains('is-collapsed')
      )
        throw new Error('IMAGE_NOT_DRAWN');
      await abortable(mounted.decode(), signal);
      await frame(signal);
      const rect = mounted.getBoundingClientRect();
      const viewport = node
        .closest<HTMLElement>('[role="log"],.history-lines,.story-dialog-body')
        ?.getBoundingClientRect();
      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        rect.bottom <= 0 ||
        rect.top >= innerHeight ||
        (viewport && (rect.bottom <= viewport.top || rect.top >= viewport.bottom)) ||
        document.hidden ||
        epoch !== this.epoch
      )
        throw new Error('IMAGE_NOT_VISIBLE');
      signal.throwIfAborted();
      this.prepared.delete(payload.shareId);
    } catch (error) {
      this.prepared.delete(payload.shareId);
      URL.revokeObjectURL(entry.url);
      this.urls.delete(entry.url);
      if (epoch === this.epoch)
        this.patch(payload.shareId, {
          display: signal.aborted ? 'placeholder' : 'load_failed',
          url: undefined,
        });
      throw error;
    }
  }
  async restore(share: ImageShareView) {
    if (!share.presentedAt || !share.assetId || share.url || share.operation) return;
    const epoch = this.epoch;
    const signal = this.abort.signal;
    let url: string | undefined;
    this.patch(share.shareId, { operation: true });
    try {
      const blob = await this.api.image(`/api/media/${share.assetId}`, signal);
      signal.throwIfAborted();
      url = URL.createObjectURL(blob);
      if (epoch !== this.epoch) throw new Error('STALE_IMAGE');
      const img = new Image();
      img.src = url;
      await abortable(img.decode(), signal);
      signal.throwIfAborted();
      if (epoch !== this.epoch) throw new Error('STALE_IMAGE');
      this.urls.add(url);
      this.patch(share.shareId, { url, display: 'presented' });
    } catch {
      if (url) {
        URL.revokeObjectURL(url);
        this.urls.delete(url);
      }
      if (epoch === this.epoch) this.patch(share.shareId, { display: 'load_failed' });
    } finally {
      if (epoch === this.epoch) this.patch(share.shareId, { operation: false });
    }
  }
  collapse(id: string) {
    const share = this.state.imageShares[id];
    if (share) {
      if (share.display === 'loading') this.inputChanged();
      this.patch(id, { collapsed: !share.collapsed });
    }
  }
  async cancel(id: string) {
    const share = this.state.imageShares[id];
    if (!share || share.operation) return;
    this.inputChanged();
    this.patch(id, { cancelRequested: true, operation: true });
    const epoch = this.epoch;
    try {
      const result = await this.api.cancelImage(id, this.abort.signal);
      if (epoch === this.epoch) this.merge(result);
    } catch (error) {
      if (epoch === this.epoch) this.requestFailed(id, error);
    } finally {
      if (epoch === this.epoch) this.patch(id, { operation: false });
    }
  }
  async retry(id: string) {
    const share = this.state.imageShares[id];
    if (!share || !share.canRetryGeneration || share.cancelRequested || share.operation) return;
    const epoch = this.epoch;
    this.patch(id, { operation: true });
    try {
      const result = await this.api.retryImage(
        id,
        share.version,
        crypto.randomUUID(),
        this.abort.signal,
      );
      if (epoch === this.epoch) this.merge(result);
    } catch (error) {
      if (epoch === this.epoch) this.requestFailed(id, error);
    } finally {
      if (epoch === this.epoch) this.patch(id, { operation: false });
    }
  }
  async view(id: string) {
    const share = this.state.imageShares[id];
    if (!share) return;
    if (share.cancelRequested || (share.display === 'presented' && !share.presentedAt)) return;
    if (share.presentedAt) {
      await this.restore(share);
      return;
    }
    if (this.idle(true) && !share.collapsed) {
      const activity = this.userActivityRevision;
      try {
        await this.revealPreview(id);
      } catch {
        return;
      }
      if (activity === this.userActivityRevision && this.idle(true))
        await this.deliver(this.state.imageShares[id]!, this.revision);
    }
  }
  private idle(manual = false) {
    return (
      !!this.sessionId &&
      this.state.connected &&
      !this.state.connecting &&
      !this.state.sessionExpired &&
      !document.hidden &&
      navigator.onLine &&
      this.state.playback === 'idle' &&
      this.state.interaction === 'idle' &&
      this.state.recording === 'idle' &&
      this.state.voicePreview === 'idle' &&
      this.state.animation === 'live2d' &&
      !this.gates.composing &&
      (manual || (!this.heldInputs.size && Date.now() > this.activityUntil)) &&
      !this.gates.draft &&
      (manual || !this.gates.reading) &&
      (manual || !this.gates.modal) &&
      this.gates.appearance &&
      (manual || !document.querySelector('dialog[open]'))
    );
  }
  private schedule(delay: number) {
    this.timer = setTimeout(() => {
      void this.tick();
    }, delay);
  }
  private async tick() {
    if (this.abort.signal.aborted) return;
    const epoch = this.epoch;
    let delay = 2000;
    try {
      if (!this.sessionId || !this.state.connected || document.hidden || !navigator.onLine) {
        this.wasIdle = false;
        return;
      }
      if (!this.flight) {
        const shares = Object.values(this.state.imageShares).filter(
          (share) => !['cancelled', 'expired', 'presented'].includes(share.phase),
        );
        const share = shares[0];
        if (share) {
          this.flight = true;
          try {
            const result = share.cancelRequested
              ? await this.api.cancelImage(share.shareId, this.abort.signal)
              : await this.api.imageShare(share.shareId, this.abort.signal);
            if (epoch !== this.epoch) return;
            this.merge(result);
            this.errors = 0;
          } catch (error) {
            if (epoch === this.epoch) {
              this.requestFailed(share.shareId, error);
              delay = Math.min(30000, 2000 * 2 ** ++this.errors);
            }
          } finally {
            this.flight = false;
          }
        }
      }
      const idle = this.idle();
      if (idle && !this.wasIdle) this.idleCycle++;
      this.wasIdle = idle;
      if (idle) {
        const ready = Object.values(this.state.imageShares).find(
          (share) =>
            share.phase === 'ready' &&
            !share.collapsed &&
            !share.operation &&
            !share.cancelRequested &&
            !share.networkError &&
            share.display !== 'load_failed' &&
            share.display !== 'presented' &&
            this.visiblePreview(share.shareId),
        );
        if (ready) {
          const key = `${ready.version}:${this.idleCycle}`;
          if (this.attempted.get(ready.shareId) !== key) {
            this.attempted.set(ready.shareId, key);
            await this.deliver(ready, this.revision);
          }
        }
      }
    } finally {
      if (!this.abort.signal.aborted) this.schedule(delay);
    }
  }
  dispose() {
    document.removeEventListener('pointerdown', this.pointerDown, true);
    document.removeEventListener('pointerup', this.pointerUp, true);
    document.removeEventListener('pointercancel', this.pointerUp, true);
    document.removeEventListener('keydown', this.keyDown, true);
    document.removeEventListener('keyup', this.keyUp, true);
    window.removeEventListener('blur', this.releaseInputs);
    this.heldInputs.clear();
    clearTimeout(this.timer);
    this.abort.abort();
    this.epoch++;
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.clear();
    this.nodes.clear();
  }
}
