import { ServerEventSchema, sameTurn, type Receipt, type TurnIdentity } from '@mira/protocol';
import { ApiClient, ApiError } from '../api/client.js';
import { readSse } from '../api/sse.js';
import type { PlaybackScheduler } from '../playback/scheduler.js';
import type { SceneStore } from '../stores/scene.js';
import { acquireMicrophone, RecordingController } from './recorder.js';
import { ReceiptBook } from './receipts.js';

export class TurnController {
  private sessionId = '';
  private generation = 0;
  private current?: TurnIdentity;
  private active = new AbortController();
  private connection = new AbortController();
  private begin?: Promise<void>;
  private recording?: RecordingController;
  private receipts = new ReceiptBook();
  private flushing = false;
  private disposed = false;
  private epoch = 0;

  constructor(
    private readonly api: ApiClient,
    private readonly playback: PlaybackScheduler,
    private readonly store: SceneStore,
  ) {}

  async connect(reset = false): Promise<void> {
    const epoch = ++this.epoch;
    this.interrupt();
    this.connection.abort();
    this.connection = new AbortController();
    const signal = this.connection.signal;
    this.store.connecting = true;
    this.store.connected = false;
    this.store.failure = '';
    try {
      if (this.sessionId && !reset) {
        const snapshot = await this.api.snapshot(signal);
        if (this.disposed || epoch !== this.epoch) return;
        this.generation = Math.max(this.generation, snapshot.generation);
        this.store.voiceInput = snapshot.capabilities.voiceInput;
        this.store.environment = snapshot.scene.environment;
        this.store.facts = snapshot.scene.facts;
      } else {
        this.api.clear();
        const session = await this.api.createSession(signal);
        if (this.disposed || epoch !== this.epoch) return;
        this.sessionId = session.sessionId;
        this.generation = 0;
        this.receipts.clear();
        this.store.mode = session.mode;
        this.store.voiceInput = session.capabilities.voiceInput;
        this.store.environment = session.scene.environment;
        this.store.facts = session.scene.facts;
        this.store.emotion = 'guarded';
      }
      this.store.connected = true;
    } catch (error) {
      if (signal.aborted || this.disposed || epoch !== this.epoch) return;
      this.store.connected = false;
      this.store.failure =
        error instanceof ApiError ? error.message : '故事暂时没有连接上，请重新连接。';
      if (error instanceof ApiError && ['SESSION_EXPIRED', 'UNAUTHORIZED'].includes(error.code))
        this.sessionId = '';
    } finally {
      if (epoch === this.epoch && !this.disposed) this.store.connecting = false;
    }
  }

  send(text: string): void {
    const clean = text.trim();
    if (!clean || !this.store.connected) return;
    void this.playback.unlock().catch(() => undefined);
    const turn = this.start();
    void this.submit(turn, clean);
  }
  press(): void {
    if (!this.store.connected || this.recording) return;
    if (!this.store.voiceInput) {
      this.store.failure = '当前模式暂不支持语音输入，请使用文字输入。';
      return;
    }
    void this.playback.unlock().catch(() => undefined);
    const turn = this.start();
    const recorder = new RecordingController({
      acquire: acquireMicrophone,
      isCurrent: () => this.isCurrent(turn),
      visible: () => !document.hidden,
      phase: (phase) => {
        if (!this.isCurrent(turn)) return;
        this.store.recording = phase;
        this.store.interaction = phase === 'recording' ? 'listening' : 'idle';
      },
      submit: (blob, durationMs) => {
        if (!this.isCurrent(turn)) return;
        this.recording = undefined;
        void this.submit(turn, { blob, durationMs });
      },
      fail: (message) => {
        if (this.isCurrent(turn)) {
          this.recording = undefined;
          this.store.failure = message;
        }
      },
    });
    this.recording = recorder;
    void recorder.press();
  }
  release(): void {
    this.recording?.release();
    if (this.store.recording === 'idle') this.recording = undefined;
  }
  expire(turn: TurnIdentity): void {
    if (this.isCurrent(turn)) this.interrupt();
  }
  cancelRecording(): void {
    this.interrupt();
  }

  interrupt(): void {
    const previous = this.current;
    this.current = undefined;
    this.active.abort();
    this.playback.cancel();
    this.recording?.cancel();
    this.recording = undefined;
    this.store.recording = 'idle';
    if (previous) {
      const snapshot = this.receipts.freeze(previous);
      // Network cancellation is best effort; the next begin includes this frozen snapshot.
      void this.api.cancel(previous, snapshot).catch(() => undefined);
    }
  }

  receipt(value: Omit<Receipt, keyof TurnIdentity | 'receiptId'>, turn: TurnIdentity): void {
    if (!this.isCurrent(turn)) return;
    const receipt = { ...turn, ...value, receiptId: crypto.randomUUID() };
    if (!this.receipts.record(receipt)) return;
    if (value.status === 'presented' && value.kind === 'photo')
      this.store.facts.photo_revealed = true;
    if (value.status === 'presented' && value.kind === 'environment')
      this.store.facts.rain_softened = true;
    void this.flush();
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    this.interrupt();
    this.connection.abort();
    this.receipts.clear();
    this.api.clear();
    await this.playback.dispose();
  }
  private start(): TurnIdentity {
    this.interrupt();
    const turn = {
      sessionId: this.sessionId,
      generation: ++this.generation,
      turnId: crypto.randomUUID(),
    };
    this.current = turn;
    this.active = new AbortController();
    this.store.failure = '';
    this.store.transcribed = '';
    this.playback.begin(turn);
    this.begin = this.api
      .begin(turn, this.receipts.outbox(), this.receipts.snapshots(), this.active.signal)
      .then((response) => {
        this.receipts.acknowledge(response.acknowledged);
        if (!this.isCurrent(turn)) return;
        if (response.status !== 'begun')
          throw new ApiError('TURN_CONFLICT', '这段回应已经结束，请再说一句。');
      });
    // Recording may still be waiting for permission; consume the begin failure immediately.
    void this.begin.catch((error) => this.fail(turn, error));
    return turn;
  }
  private async submit(
    turn: TurnIdentity,
    input: string | { blob: Blob; durationMs: number },
  ): Promise<void> {
    const begin = this.begin;
    const signal = this.active.signal;
    try {
      await begin;
      if (!this.isCurrent(turn)) return;
      this.store.interaction = 'thinking';
      this.playback.inputSubmitted(turn);
      const response = await this.api.input(turn, input, crypto.randomUUID(), signal);
      if (!this.isCurrent(turn)) return;
      if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream'))
        throw new Error('INVALID_STREAM');
      let seq = 0;
      let done = false;
      const seen = new Map<string, string>();
      await readSse(
        response.body,
        (data) => {
          if (!this.isCurrent(turn)) return;
          const event = ServerEventSchema.parse(data);
          if (!sameTurn(event, turn)) throw new Error('STREAM_IDENTITY');
          const serialized = JSON.stringify(event);
          const duplicate = seen.get(event.eventId);
          if (duplicate) {
            if (duplicate !== serialized) throw new Error('STREAM_CONFLICT');
            return;
          }
          if (
            event.seq !== seq + 1 ||
            (seq === 0 && event.type !== 'ready') ||
            (seq > 0 && event.type === 'ready') ||
            done
          )
            throw new Error('STREAM_SEQUENCE');
          if (seen.size >= 32) throw new Error('STREAM_LIMIT');
          seq = event.seq;
          seen.set(event.eventId, serialized);
          switch (event.type) {
            case 'ready':
              this.playback.applyLifetime(turn, event.payload.remainingLifetimeMs);
              break;
            case 'input.transcribed':
              this.store.transcribed = event.payload.text;
              this.store.simulated = event.payload.simulated;
              break;
            case 'audio.ready':
              this.playback.enqueue(turn, event.payload);
              break;
            case 'reply.done':
              done = true;
              this.playback.generationDone(turn);
              break;
            case 'error':
              throw new ApiError(
                event.payload.code,
                event.payload.message,
                event.payload.retryable,
              );
          }
        },
        signal,
      );
      if (!done) throw new Error('STREAM_INTERRUPTED');
      // Normal EOF leaves all valid queued audio and visual work alive.
    } catch (error) {
      this.fail(turn, error);
    }
  }
  private isCurrent(turn: TurnIdentity): boolean {
    return !this.disposed && sameTurn(turn, this.current) && !this.active.signal.aborted;
  }
  private fail(turn: TurnIdentity, error: unknown): void {
    if (!this.isCurrent(turn)) return;
    this.interrupt();
    this.store.failure =
      error instanceof ApiError
        ? error.message
        : '连接暂时断开，故事停在这里。请重新连接或再说一句。';
    if (error instanceof ApiError && ['SESSION_EXPIRED', 'UNAUTHORIZED'].includes(error.code)) {
      this.store.connected = false;
      this.sessionId = '';
    }
  }
  private async flush(): Promise<void> {
    if (this.flushing || this.disposed) return;
    this.flushing = true;
    try {
      while (this.receipts.outbox().length && !this.disposed) {
        const snapshot = this.receipts.outbox();
        const response = await this.api.receipts(snapshot);
        this.receipts.acknowledge(response.acknowledged);
        if (!response.acknowledged.length) break;
      }
    } catch {
      /* The bounded outbox is retried atomically by the next begin. */
    } finally {
      this.flushing = false;
    }
  }
}
