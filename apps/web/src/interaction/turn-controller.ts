import {
  ServerEventSchema,
  sameTurn,
  type Receipt,
  type TurnIdentity,
  type StoryInteraction,
} from '@mira/protocol';
import { ApiClient, ApiError } from '../api/client.js';
import { readSse } from '../api/sse.js';
import type { PlaybackScheduler } from '../playback/scheduler.js';
import type { InteractiveState } from './state.js';
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
  private recoveryAttempts = 0;
  private nextRecoveryAt = 0;
  private automaticRecoveryBlocked = false;
  private rateLimitedUntil = 0;

  constructor(
    private readonly api: ApiClient,
    private readonly playback: PlaybackScheduler,
    private readonly store: InteractiveState,
  ) {}

  async connect(reset = false): Promise<void> {
    if (this.disposed || (!reset && this.store.connecting) || Date.now() < this.rateLimitedUntil)
      return;
    if (reset) this.store.sessionExpired = false;
    if (this.store.sessionExpired && !reset) return;
    this.automaticRecoveryBlocked = false;
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
        const pending = this.receipts.outbox();
        if (pending.length) {
          const acknowledged = await this.api.receipts(pending, signal);
          if (this.disposed || epoch !== this.epoch) return;
          this.receipts.acknowledge(acknowledged.acknowledged);
        }
        const snapshot = await this.api.snapshot(signal);
        if (this.disposed || epoch !== this.epoch) return;
        this.generation = Math.max(this.generation, snapshot.generation);
        this.store.voiceInput = snapshot.capabilities.voiceInput;
        this.store.scenario = snapshot.scene.scenario ?? null;
        this.store.environment = snapshot.scene.environment;
        this.store.facts = snapshot.scene.facts;
        if (snapshot.scene.story) this.store.story = snapshot.scene.story;
      } else {
        this.api.clear();
        const session = await this.api.createSession(signal);
        if (this.disposed || epoch !== this.epoch) return;
        this.sessionId = session.sessionId;
        this.generation = 0;
        this.receipts.clear();
        this.store.mode = session.mode;
        this.store.voiceInput = session.capabilities.voiceInput;
        this.store.scenario = session.scene.scenario ?? null;
        this.store.environment = session.scene.environment;
        this.store.facts = session.scene.facts;
        if (session.scene.story) this.store.story = session.scene.story;
        this.store.emotion = 'guarded';
        this.store.narration = '';
        this.store.opening = session.opening ?? null;
      }
      this.store.connected = true;
      this.store.sessionExpired = false;
      this.recoveryAttempts = 0;
      this.nextRecoveryAt = 0;
      this.automaticRecoveryBlocked = false;
      this.rateLimitedUntil = 0;
    } catch (error) {
      if (signal.aborted || this.disposed || epoch !== this.epoch) return;
      this.store.connected = false;
      this.store.failure =
        error instanceof ApiError ? error.message : '故事暂时没有连接上，请重新连接。';
      this.recoveryAttempts += 1;
      this.nextRecoveryAt =
        Date.now() + Math.min(30_000, 1_000 * 2 ** Math.min(this.recoveryAttempts - 1, 5));
      this.automaticRecoveryBlocked = !(error instanceof ApiError) || !error.retryable;
      if (
        error instanceof ApiError &&
        (error.code === 'RATE_LIMITED' || error.httpStatus === 429)
      ) {
        this.rateLimitedUntil = Date.now() + 60_000;
        this.nextRecoveryAt = Math.max(this.nextRecoveryAt, this.rateLimitedUntil);
      }
      if (error instanceof ApiError && error.code === 'STALE_TURN')
        void this.recoverConnection(true, true);
      if (error instanceof ApiError && ['SESSION_EXPIRED', 'UNAUTHORIZED'].includes(error.code)) {
        this.store.sessionExpired = true;
        this.sessionId = '';
      }
    } finally {
      if (epoch === this.epoch && !this.disposed) this.store.connecting = false;
    }
  }

  /** Automatic recovery is for a disconnected, idle session, never an active reply. */
  async recoverConnection(force = false, verifySession = false): Promise<void> {
    const activePlayback =
      this.store.playback !== 'idle' ||
      this.store.interaction === 'thinking' ||
      this.store.interaction === 'speaking' ||
      this.store.recording !== 'idle' ||
      this.store.voicePreview !== 'idle';
    if (
      this.disposed ||
      this.automaticRecoveryBlocked ||
      Date.now() < this.rateLimitedUntil ||
      (this.store.connected && !verifySession) ||
      this.store.connecting ||
      (this.current && (!verifySession || activePlayback)) ||
      this.recording ||
      this.store.sessionExpired
    )
      return;
    if (!force && Date.now() < this.nextRecoveryAt) return;
    await this.connect();
  }
  pauseRecovery(): void {
    if (this.disposed || !this.store.connecting) return;
    ++this.epoch;
    this.connection.abort();
    this.store.connecting = false;
  }
  connectionLost(): void {
    if (this.disposed) return;
    ++this.epoch;
    this.connection.abort();
    this.interrupt();
    this.store.connected = false;
    this.store.connecting = false;
    if (
      !this.store.sessionExpired &&
      !this.automaticRecoveryBlocked &&
      Date.now() >= this.rateLimitedUntil
    )
      this.store.failure = '与服务端的连接已中断，正在自动重连。';
  }

  send(text: string): void {
    const clean = text.trim();
    if (!clean || !this.store.connected) return;
    void this.playback.unlock().catch(() => undefined);
    const turn = this.start();
    void this.submit(turn, clean);
  }
  interact(interaction: StoryInteraction): void {
    if (!this.store.connected) return;
    void this.playback.unlock().catch(() => undefined);
    const turn = this.start();
    void this.submit(turn, { interaction });
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
        this.store.interaction =
          phase === 'recording'
            ? 'listening'
            : this.store.voicePreview === 'transcribing'
              ? 'thinking'
              : 'idle';
      },
      submit: (blob, durationMs) => {
        if (!this.isCurrent(turn)) return;
        this.recording = undefined;
        void this.previewRecording(turn, { blob, durationMs });
      },
      fail: (message) => {
        if (this.isCurrent(turn)) {
          this.recording = undefined;
          this.failVoiceInput(turn, message);
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
    this.store.voicePreview = 'idle';
    this.store.voiceInputError = '';
    this.store.voiceDraft = '';
    this.store.voiceDraftSimulated = false;
    if (previous) {
      const snapshot = this.receipts.freeze(previous);
      // Network cancellation is best effort; the next begin includes this frozen snapshot.
      void this.api.cancel(previous, snapshot).catch(() => undefined);
    }
  }
  discardVoicePreview(): void {
    this.interrupt();
  }

  receipt(value: Omit<Receipt, keyof TurnIdentity | 'receiptId'>, turn: TurnIdentity): void {
    if (!this.isCurrent(turn)) return;
    const receipt = { ...turn, ...value, receiptId: crypto.randomUUID() };
    if (!this.receipts.record(receipt)) return;
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
    input: string | { blob: Blob; durationMs: number } | { interaction: StoryInteraction },
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
            case 'presentation.ready':
              this.playback.enqueuePresentation(turn, event.payload);
              break;
            case 'reply.done':
              done = true;
              this.playback.generationDone(turn, event.payload.suggestions ?? []);
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
  private async previewRecording(
    turn: TurnIdentity,
    audio: { blob: Blob; durationMs: number },
  ): Promise<void> {
    const begin = this.begin;
    const signal = this.active.signal;
    this.store.voicePreview = 'transcribing';
    this.store.interaction = 'thinking';
    try {
      await begin;
      if (!this.isCurrent(turn)) return;
      const preview = await this.api.transcribe(turn, audio, crypto.randomUUID(), signal);
      if (!this.isCurrent(turn)) return;
      if (!sameTurn(preview, turn)) throw new Error('TRANSCRIPTION_IDENTITY');
      // The recording round has no reply. Its text remains a draft until a new confirmed input.
      this.playback.cancel();
      this.store.voiceDraft = preview.text;
      this.store.voiceDraftSimulated = preview.simulated;
      this.store.voicePreview = 'ready';
    } catch (error) {
      if (
        error instanceof ApiError &&
        [
          'NO_SPEECH',
          'INVALID_REQUEST',
          'UNSUPPORTED_AUDIO',
          'UPLOAD_TOO_LARGE',
          'PROVIDER_FAILED',
          'PROVIDER_TIMEOUT',
          'CAPACITY_EXCEEDED',
          'RATE_LIMITED',
        ].includes(error.code)
      )
        this.failVoiceInput(turn, error.message);
      else this.fail(turn, error);
    }
  }
  private isCurrent(turn: TurnIdentity): boolean {
    return !this.disposed && sameTurn(turn, this.current) && !this.active.signal.aborted;
  }
  private failVoiceInput(turn: TurnIdentity, message: string): void {
    if (!this.isCurrent(turn)) return;
    this.interrupt();
    this.store.voiceInputError = message;
  }
  private fail(turn: TurnIdentity, error: unknown): void {
    if (!this.isCurrent(turn)) return;
    if (error instanceof ApiError && error.code === 'NO_SPEECH') {
      this.failVoiceInput(turn, error.message);
      return;
    }
    this.interrupt();
    this.store.failure =
      error instanceof ApiError
        ? error.message
        : error instanceof Error && error.message === 'SSE_IDLE_TIMEOUT'
          ? '回复等待超时，已停止本轮，可以重新发送消息。'
          : '这次回复未完成，未播放的内容已停止，可以重新发送消息。';
    if (error instanceof ApiError && error.code === 'STALE_TURN')
      void this.recoverConnection(true, true);
    if (error instanceof ApiError && ['SESSION_EXPIRED', 'UNAUTHORIZED'].includes(error.code)) {
      this.store.connected = false;
      this.store.sessionExpired = true;
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
