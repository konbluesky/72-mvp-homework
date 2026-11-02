import {
  sameTurn,
  type Action,
  type SpeechReadyPayload,
  type ImagePendingPayload,
  type ImageReadyPayload,
  type Emotion,
  type Interaction,
  type PresentationEvent,
  type PresentationReadyPayload,
  type Receipt,
  type ReplySuggestion,
  type TurnIdentity,
  type StoryState,
  type Facts,
} from '@mira/protocol';
import type { AudioPort, PreparedAudio } from './audio.js';
import { abortable } from './abortable.js';

export type PlaybackMode = 'idle' | 'buffering' | 'audio' | 'audio-error' | 'text';
export interface PlaybackView {
  interaction: Interaction;
  subtitle: string;
  narration: string;
  emotion: Emotion;
  action: Action;
  mouthOpen: number;
  playback: PlaybackMode;
  suggestions: ReplySuggestion[];
  story: StoryState;
  facts: Facts;
  environment: string;
}
export interface PresentationPort {
  photo(event: Extract<PresentationEvent, { type: 'photo' }>, signal: AbortSignal): Promise<void>;
  environment(
    event: Extract<PresentationEvent, { type: 'environment' }>,
    signal: AbortSignal,
  ): Promise<void>;
  execute?(
    event: Exclude<PresentationEvent, { type: 'photo' | 'environment' }>,
    signal: AbortSignal,
  ): Promise<void>;
  previewScene?(zoom: number, weather: string, signal: AbortSignal): Promise<void>;
  previewMotion?(group: string): void;
  errorMessage?(event: PresentationEvent): string;
  clear(): void;
}
interface SchedulerOptions {
  audio: AudioPort;
  presentation: PresentationPort;
  view(value: Partial<PlaybackView>): void;
  receipt(value: Omit<Receipt, keyof TurnIdentity | 'receiptId'>, turn: TurnIdentity): void;
  failure(message: string): void;
  expired?(turn: TurnIdentity): void;
  cancelled?(turn: TurnIdentity): void;
  started?(turn: TurnIdentity): void;
  presented?(turn: TurnIdentity, success: boolean): void;
  now?: () => number;
  timing?(name: string, durationMs: number): void;
  loadTimeoutMs?: number;
}
type ImageUnit = { imagePending: ImagePendingPayload } | { imageReady: ImageReadyPayload };
export interface ImagePresentationPort {
  prepare?(payload: ImageReadyPayload, signal: AbortSignal): Promise<void>;
  pending(payload: ImagePendingPayload, signal: AbortSignal): Promise<void>;
  ready(payload: ImageReadyPayload, signal: AbortSignal): Promise<void>;
}
type PreparedResult = { ok: true; audio: PreparedAudio } | { ok: false };

/** Owns audio, captions, visual events and every callback attached to their turn. */
export class PlaybackScheduler {
  private turn?: TurnIdentity;
  private images?: ImagePresentationPort;
  setImages(port: ImagePresentationPort) {
    this.images = port;
  }
  private cancellation = new AbortController();
  private queue: Array<SpeechReadyPayload | PresentationReadyPayload | ImageUnit> = [];
  private prepared = new Map<string, Promise<PreparedResult>>();
  private stop?: () => void;
  private draining = 0;
  private sequence = 0;
  private completed = false;
  private completionNotified = false;
  private suggestions: ReplySuggestion[] = [];
  private presentationFailed = false;
  private confirmedNarration = '';
  private blocked?: SpeechReadyPayload;
  private text?: SpeechReadyPayload;
  private textVisual?: Promise<boolean>;
  private lifetime?: ReturnType<typeof setTimeout>;
  private received = new Set<string>();
  private now: () => number;
  private inputAt?: number;
  private firstStarted = false;
  private previewAbort?: AbortController;
  private previewTimer?: ReturnType<typeof setTimeout>;
  private readyAt = new Map<string, number>();

  constructor(private readonly options: SchedulerOptions) {
    this.now = options.now ?? (() => performance.now());
  }
  unlock(): Promise<void> {
    return this.options.audio.unlock();
  }

  begin(turn: TurnIdentity): void {
    this.cancel();
    this.turn = turn;
    this.cancellation = new AbortController();
    this.completed = false;
    this.completionNotified = false;
    this.presentationFailed = false;
    this.confirmedNarration = '';
    this.options.view({ interaction: 'thinking', playback: 'buffering', narration: '' });
  }

  applyLifetime(turn: TurnIdentity, remainingMs: number): void {
    if (!this.current(turn)) return;
    clearTimeout(this.lifetime);
    // The server budget begins at input, not while the user is granting microphone access.
    // Finish slightly earlier so frozen receipts can arrive before server retirement.
    this.lifetime = setTimeout(
      () => {
        if (!this.current(turn)) return;
        this.cancel();
        this.options.expired?.(turn);
        this.options.failure('这次回应已结束，请重新说一句，我们继续聊。');
      },
      Math.max(0, remainingMs - 1_000),
    );
  }

  inputSubmitted(turn: TurnIdentity): void {
    if (this.current(turn)) {
      this.inputAt = this.now();
      this.firstStarted = false;
    }
  }

  enqueue(turn: TurnIdentity, segment: SpeechReadyPayload): void {
    if (!this.current(turn) || this.received.has(segment.segmentId)) return;
    if (this.readyAt.size >= 4) throw new Error('PLAYBACK_QUEUE_LIMIT');
    this.received.add(segment.segmentId);
    this.readyAt.set(segment.segmentId, this.now());
    this.queue.push(segment);
    this.prefetch();
    void this.pump(turn);
  }
  enqueuePresentation(turn: TurnIdentity, payload: PresentationReadyPayload): void {
    if (!this.current(turn) || this.received.has(payload.presentationId)) return;
    if (this.received.size >= 12) throw new Error('PLAYBACK_QUEUE_LIMIT');
    this.received.add(payload.presentationId);
    this.queue.push(payload);
    void this.pump(turn);
  }
  enqueueImagePending(turn: TurnIdentity, payload: ImagePendingPayload): void {
    if (!this.current(turn) || this.received.has(payload.slotEventId)) return;
    this.enqueue(turn, payload.introduction);
    this.received.add(payload.slotEventId);
    this.queue.push({ imagePending: payload });
    void this.pump(turn);
  }
  enqueueImageReady(turn: TurnIdentity, payload: ImageReadyPayload): void {
    if (!this.current(turn) || this.received.has(payload.imageEventId)) return;
    this.received.add(payload.imageEventId);
    this.queue.push({ imageReady: payload });
    void this.pump(turn);
  }
  generationDone(turn: TurnIdentity, suggestions: ReplySuggestion[] = []): void {
    if (!this.current(turn)) return;
    this.completed = true;
    this.suggestions = suggestions.map((suggestion) => ({ ...suggestion }));
    this.finishIfEmpty();
  }

  async useText(): Promise<void> {
    const segment = this.blocked;
    const turn = this.turn;
    if (!segment || !turn) return;
    this.blocked = undefined;
    this.text = segment;
    this.options.started?.(turn);
    this.options.view({
      interaction: 'idle',
      subtitle: segment.text,
      emotion: segment.emotion,
      action: segment.action,
      mouthOpen: 0,
      playback: 'text',
    });
    this.textVisual = this.present(segment.events, turn, this.cancellation.signal);
    await this.textVisual;
  }
  async continueText(): Promise<void> {
    const segment = this.text;
    const turn = this.turn;
    if (!segment || !turn) return;
    this.text = undefined;
    await this.textVisual;
    if (!this.current(turn)) return;
    this.options.receipt(
      { targetId: segment.segmentId, kind: 'segment', status: 'presented', mode: 'text' },
      turn,
    );
    this.queue.shift();
    this.prepared.delete(segment.segmentId);
    this.options.view({ subtitle: '', action: 'none', playback: 'buffering' });
    this.prefetch();
    void this.pump(turn);
  }
  async retryAudio(): Promise<void> {
    const segment = this.blocked;
    const turn = this.turn;
    if (!segment || !turn) return;
    try {
      await this.unlock();
    } catch {
      this.options.failure('声音仍不可用，可以选择用字幕继续。');
      return;
    }
    if (!this.current(turn)) return;
    this.blocked = undefined;
    this.prepared.delete(segment.segmentId);
    this.prefetch();
    void this.pump(turn);
  }
  cancel(): void {
    clearTimeout(this.previewTimer);
    this.previewAbort?.abort();
    this.previewAbort = undefined;
    const interrupted = !!this.turn;
    const started = this.now();
    this.turn = undefined;
    this.cancellation.abort();
    this.sequence += 1;
    this.draining = 0;
    this.stop?.();
    this.stop = undefined;
    this.queue = [];
    this.prepared.clear();
    this.received.clear();
    this.readyAt.clear();
    this.suggestions = [];
    this.inputAt = undefined;
    this.firstStarted = false;
    this.blocked = undefined;
    this.text = undefined;
    this.textVisual = undefined;
    clearTimeout(this.lifetime);
    this.options.presentation.clear();
    this.options.view({
      interaction: 'idle',
      subtitle: '',
      action: 'none',
      mouthOpen: 0,
      playback: 'idle',
      suggestions: [],
      narration: this.confirmedNarration,
    });
    if (interrupted) this.options.timing?.('interrupt-stop', this.now() - started);
  }
  preview(action: Action, interaction: Interaction = 'idle', motion?: string): void {
    this.cancel();
    const owner = this.sequence;
    this.options.view({ interaction, action, mouthOpen: 0, emotion: 'curious' });
    if (motion) this.options.presentation.previewMotion?.(motion);
    this.previewTimer = setTimeout(
      () => {
        if (owner !== this.sequence || this.turn) return;
        this.options.presentation.clear();
        this.options.view({ interaction: 'idle', action: 'none', mouthOpen: 0 });
      },
      motion ? 5400 : 3000,
    );
  }
  previewScene(zoom: number, weather: string): void {
    this.cancel();
    const owner = this.sequence;
    this.previewAbort = new AbortController();
    void this.options.presentation
      .previewScene?.(zoom, weather, this.previewAbort.signal)
      .catch(() => {
        if (owner === this.sequence) this.options.failure('舞台预览未完成，已保留故事状态。');
      });
    this.previewTimer = setTimeout(() => {
      if (owner === this.sequence) this.cancel();
    }, 5000);
  }
  async dispose(): Promise<void> {
    this.cancel();
    await this.options.audio.dispose();
  }
  private current(turn: TurnIdentity): boolean {
    return sameTurn(this.turn, turn) && !this.cancellation.signal.aborted;
  }

  private prefetch(): void {
    // The current sentence and only its immediate successor may hold decoded audio.
    for (const segment of this.queue.slice(0, 2)) {
      if (
        !('segmentId' in segment) ||
        !('audioUrl' in segment) ||
        this.prepared.has(segment.segmentId)
      )
        continue;
      const signal = AbortSignal.any([
        this.cancellation.signal,
        AbortSignal.timeout(this.options.loadTimeoutMs ?? 12_000),
      ]);
      const start = this.now();
      const preparation = abortable(this.options.audio.prepare(segment.audioUrl, signal), signal)
        .then((audio) => {
          signal.throwIfAborted();
          this.options.timing?.('media-ready', this.now() - start);
          return { ok: true as const, audio };
        })
        .catch(() => ({ ok: false as const }));
      this.prepared.set(segment.segmentId, preparation);
    }
  }
  private async pump(turn: TurnIdentity): Promise<void> {
    if (!this.current(turn) || this.draining || this.blocked || this.text) return;
    const segment = this.queue[0];
    if (!segment) {
      this.finishIfEmpty();
      return;
    }
    const owner = ++this.sequence;
    this.draining = owner;
    if ('imagePending' in segment || 'imageReady' in segment) {
      const pending = 'imagePending' in segment;
      const payload = pending ? segment.imagePending : segment.imageReady;
      const targetId = 'slotEventId' in payload ? payload.slotEventId : payload.imageEventId;
      try {
        const signal = AbortSignal.any([
          this.cancellation.signal,
          AbortSignal.timeout(this.options.loadTimeoutMs ?? 12000),
        ]);
        if (!this.images) throw new Error('IMAGE_UNSUPPORTED');
        if ('slotEventId' in payload) await this.images.pending(payload, signal);
        else {
          const intro = payload.introduction;
          const audio =
            'audioUrl' in intro
              ? abortable(this.options.audio.prepare(intro.audioUrl, signal), signal)
                  .then((audio) => ({ ok: true as const, audio }))
                  .catch(() => ({ ok: false as const }))
              : Promise.resolve({ ok: false as const });
          if ('audioUrl' in intro) this.prepared.set(intro.segmentId, audio);
          await Promise.all([this.images.prepare?.(payload, signal), audio]);
          if (!this.current(turn) || this.draining !== owner) return;
          await this.images.ready(payload, signal);
        }
        if (!this.current(turn) || this.draining !== owner) return;
        this.options.receipt(
          { targetId, kind: pending ? 'image-slot' : 'image', status: 'presented' },
          turn,
        );
        this.queue.shift();
        if (!pending) {
          this.queue.unshift(payload.introduction);
          this.readyAt.set(payload.introduction.segmentId, this.now());
        }
      } catch {
        if (!this.current(turn) || this.draining !== owner) return;
        this.presentationFailed = true;
        this.options.receipt(
          { targetId, kind: pending ? 'image-slot' : 'image', status: 'failed' },
          turn,
        );
        if (!pending)
          this.options.receipt(
            { targetId: payload.introduction.segmentId, kind: 'segment', status: 'failed' },
            turn,
          );
        this.queue.shift();
      }
      this.draining = 0;
      this.prefetch();
      void this.pump(turn);
      return;
    }
    if ('presentationId' in segment) {
      this.options.started?.(turn);
      this.options.view({
        interaction: 'thinking',
        playback: 'buffering',
        mouthOpen: 0,
        subtitle: '',
        ...(segment.events.some((event) => event.type === 'beat' || event.type === 'ending')
          ? { narration: segment.caption }
          : {}),
      });
      const success = await this.present(segment.events, turn, this.cancellation.signal);
      if (!this.current(turn) || this.draining !== owner) return;
      if (!success) {
        this.cancel();
        this.options.cancelled?.(turn);
        return;
      }
      this.confirmedNarration = segment.caption;
      this.options.view({
        narration: segment.caption,
        ...(segment.environmentAfter ? { environment: segment.environmentAfter } : {}),
        ...(segment.storyAfter ? { story: segment.storyAfter } : {}),
        ...(segment.factsAfter
          ? {
              facts: segment.factsAfter,
            }
          : {}),
      });
      this.queue.shift();
      this.draining = 0;
      this.prefetch();
      void this.pump(turn);
      return;
    }
    if (!('audioUrl' in segment)) {
      this.options.started?.(turn);
      this.options.view({
        interaction: 'idle',
        playback: 'text',
        subtitle: segment.text,
        emotion: segment.emotion,
        action: segment.action,
        mouthOpen: 0,
      });
      const signal = this.cancellation.signal;
      const visual = this.present(segment.events, turn, signal);
      try {
        await abortable(
          new Promise<void>((resolve) => {
            const timer = setTimeout(
              resolve,
              Math.max(1400, Math.min(6500, segment.text.length * 130)),
            );
            signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true },
            );
          }),
          signal,
        );
        await visual;
      } catch {
        return;
      }
      if (!this.current(turn) || this.draining !== owner) return;
      this.options.receipt(
        { targetId: segment.segmentId, kind: 'segment', status: 'presented', mode: 'text' },
        turn,
      );
      this.queue.shift();
      this.draining = 0;
      this.options.view({ subtitle: '', action: 'none' });
      this.prefetch();
      void this.pump(turn);
      return;
    }
    this.options.view({ interaction: 'thinking', playback: 'buffering' });
    const prepared = await this.prepared.get(segment.segmentId);
    if (!this.current(turn) || this.draining !== owner) return;
    if (!prepared?.ok) {
      this.audioFailed(segment, owner);
      return;
    }
    const signal = this.cancellation.signal;
    let visual: Promise<boolean> = Promise.resolve(true);
    let finish = () => {};
    try {
      const ended = new Promise<void>((resolve) => {
        finish = resolve;
      });
      signal.addEventListener('abort', finish, { once: true });
      this.stop = prepared.audio.start(finish, (value) => {
        if (this.current(turn) && this.draining === owner) this.options.view({ mouthOpen: value });
      });
      const readyAt = this.readyAt.get(segment.segmentId);
      if (readyAt !== undefined)
        this.options.timing?.('audio-ready-to-playback', this.now() - readyAt);
      if (!this.firstStarted && this.inputAt !== undefined) {
        this.firstStarted = true;
        this.options.timing?.('input-to-first-playback', this.now() - this.inputAt);
      }
      this.options.view({
        interaction: 'speaking',
        subtitle: segment.text,
        emotion: segment.emotion,
        action: segment.action,
        playback: 'audio',
      });
      this.options.started?.(turn);
      visual = this.present(segment.events, turn, signal);
      await ended;
      if (!this.current(turn) || this.draining !== owner) return;
      this.stop = undefined;
      this.options.view({
        interaction: 'thinking',
        subtitle: '',
        action: 'none',
        mouthOpen: 0,
        playback: 'buffering',
      });
      this.options.receipt(
        { targetId: segment.segmentId, kind: 'segment', status: 'presented', mode: 'audio' },
        turn,
      );
      await visual;
      if (!this.current(turn) || this.draining !== owner) return;
      this.queue.shift();
      this.prepared.delete(segment.segmentId);
      this.draining = 0;
      this.prefetch();
      void this.pump(turn);
    } catch {
      if (this.current(turn) && this.draining === owner) {
        this.stop?.();
        this.stop = undefined;
        this.audioFailed(segment, owner);
      }
    } finally {
      signal.removeEventListener('abort', finish);
    }
  }
  private audioFailed(segment: SpeechReadyPayload, owner: number): void {
    if (this.draining !== owner) return;
    this.draining = 0;
    this.blocked = segment;
    this.options.view({
      interaction: 'idle',
      subtitle: '',
      action: 'none',
      mouthOpen: 0,
      playback: 'audio-error',
    });
    this.options.failure('声音暂时无法播放。可以重试声音，或用字幕继续。');
  }
  private async present(
    events: PresentationEvent[],
    turn: TurnIdentity,
    signal: AbortSignal,
  ): Promise<boolean> {
    let success = true;
    for (const event of events) {
      if (!this.current(turn)) return false;
      try {
        if (!success) throw new Error('PREREQUISITE_FAILED');
        if (event.type === 'photo') await this.options.presentation.photo(event, signal);
        else if (event.type === 'environment')
          await this.options.presentation.environment(event, signal);
        else if (this.options.presentation.execute)
          await this.options.presentation.execute(event, signal);
        else throw new Error('PRESENTATION_UNSUPPORTED');
        if (!this.current(turn)) return false;
        this.options.receipt(
          { targetId: event.eventId, kind: event.type, status: 'presented' },
          turn,
        );
      } catch {
        if (!this.current(turn)) return false;
        success = false;
        this.presentationFailed = true;
        this.options.receipt({ targetId: event.eventId, kind: event.type, status: 'failed' }, turn);
        this.options.failure(
          this.options.presentation.errorMessage?.(event) ??
            '场景呈现未完成，已保留最后成功的状态。可以重试或继续对话。',
        );
      }
    }
    return success;
  }
  private finishIfEmpty(): void {
    const turn = this.turn;
    if (this.completed && !this.queue.length && !this.draining && !this.blocked && !this.text) {
      clearTimeout(this.lifetime);
      this.options.view({
        interaction: 'idle',
        playback: 'idle',
        subtitle: '',
        action: 'none',
        mouthOpen: 0,
        // Generated choices belong to the complete reply; never expose an unheard future branch.
        suggestions: this.presentationFailed ? [] : this.suggestions,
      });
      if (turn && this.current(turn) && !this.completionNotified) {
        this.completionNotified = true;
        this.options.presented?.(turn, !this.presentationFailed);
      }
    }
  }
}
