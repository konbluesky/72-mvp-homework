import {
  sameTurn,
  type Action,
  type AudioReadyPayload,
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
  now?: () => number;
  timing?(name: string, durationMs: number): void;
  loadTimeoutMs?: number;
}
type PreparedResult = { ok: true; audio: PreparedAudio } | { ok: false };

/** Owns audio, captions, visual events and every callback attached to their turn. */
export class PlaybackScheduler {
  private turn?: TurnIdentity;
  private cancellation = new AbortController();
  private queue: Array<AudioReadyPayload | PresentationReadyPayload> = [];
  private prepared = new Map<string, Promise<PreparedResult>>();
  private stop?: () => void;
  private draining = 0;
  private sequence = 0;
  private completed = false;
  private suggestions: ReplySuggestion[] = [];
  private presentationFailed = false;
  private confirmedNarration = '';
  private blocked?: AudioReadyPayload;
  private text?: AudioReadyPayload;
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

  enqueue(turn: TurnIdentity, segment: AudioReadyPayload): void {
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
      if ('presentationId' in segment || this.prepared.has(segment.segmentId)) continue;
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
    if ('presentationId' in segment) {
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
  private audioFailed(segment: AudioReadyPayload, owner: number): void {
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
    }
  }
}
