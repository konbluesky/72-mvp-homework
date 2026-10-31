import {
  sameTurn,
  type Action,
  type AudioReadyPayload,
  type Emotion,
  type Interaction,
  type PresentationEvent,
  type Receipt,
  type TurnIdentity,
} from '@mira/protocol';
import type { AudioPort, PreparedAudio } from './audio.js';
import { abortable } from './abortable.js';

export type PlaybackMode = 'idle' | 'buffering' | 'audio' | 'audio-error' | 'text';
export interface PlaybackView {
  interaction: Interaction;
  subtitle: string;
  emotion: Emotion;
  action: Action;
  mouthOpen: number;
  playback: PlaybackMode;
}
export interface PresentationPort {
  photo(event: Extract<PresentationEvent, { type: 'photo' }>, signal: AbortSignal): Promise<void>;
  environment(
    event: Extract<PresentationEvent, { type: 'environment' }>,
    signal: AbortSignal,
  ): Promise<void>;
  clear(): void;
}
interface SchedulerOptions {
  audio: AudioPort;
  presentation: PresentationPort;
  view(value: Partial<PlaybackView>): void;
  receipt(value: Omit<Receipt, keyof TurnIdentity | 'receiptId'>, turn: TurnIdentity): void;
  failure(message: string): void;
  expired?(turn: TurnIdentity): void;
  now?: () => number;
  timing?(name: string, durationMs: number): void;
  loadTimeoutMs?: number;
}
type PreparedResult = { ok: true; audio: PreparedAudio } | { ok: false };

/** Owns audio, captions, visual events and every callback attached to their turn. */
export class PlaybackScheduler {
  private turn?: TurnIdentity;
  private cancellation = new AbortController();
  private queue: AudioReadyPayload[] = [];
  private prepared = new Map<string, Promise<PreparedResult>>();
  private stop?: () => void;
  private draining = 0;
  private sequence = 0;
  private completed = false;
  private blocked?: AudioReadyPayload;
  private text?: AudioReadyPayload;
  private textVisual?: Promise<void>;
  private lifetime?: ReturnType<typeof setTimeout>;
  private received = new Set<string>();
  private photoBlocked = false;
  private now: () => number;
  private inputAt?: number;
  private firstStarted = false;
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
    this.photoBlocked = false;
    this.options.view({ interaction: 'thinking', playback: 'buffering' });
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
    if (this.received.size >= 4) throw new Error('PLAYBACK_QUEUE_LIMIT');
    this.received.add(segment.segmentId);
    this.readyAt.set(segment.segmentId, this.now());
    this.queue.push(segment);
    this.prefetch();
    void this.pump(turn);
  }
  generationDone(turn: TurnIdentity): void {
    if (!this.current(turn)) return;
    this.completed = true;
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
    });
    if (interrupted) this.options.timing?.('interrupt-stop', this.now() - started);
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
      if (this.prepared.has(segment.segmentId)) continue;
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
    this.options.view({ interaction: 'thinking', playback: 'buffering' });
    const prepared = await this.prepared.get(segment.segmentId);
    if (!this.current(turn) || this.draining !== owner) return;
    if (!prepared?.ok) {
      this.audioFailed(segment, owner);
      return;
    }
    const signal = this.cancellation.signal;
    let visual: Promise<void> = Promise.resolve();
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
  ): Promise<void> {
    for (const event of events) {
      if (!this.current(turn)) return;
      try {
        if (event.type === 'photo') await this.options.presentation.photo(event, signal);
        else {
          if (this.photoBlocked) throw new Error('PHOTO_NOT_PRESENTED');
          await this.options.presentation.environment(event, signal);
        }
        if (!this.current(turn)) return;
        this.options.receipt(
          { targetId: event.eventId, kind: event.type, status: 'presented' },
          turn,
        );
      } catch {
        if (!this.current(turn)) return;
        if (event.type === 'photo') this.photoBlocked = true;
        this.options.receipt({ targetId: event.eventId, kind: event.type, status: 'failed' }, turn);
        this.options.failure('照片暂时打不开，可以继续对话或再请她拿出照片。');
      }
    }
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
      });
    }
  }
}
