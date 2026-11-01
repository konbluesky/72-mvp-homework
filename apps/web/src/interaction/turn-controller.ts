import {
  ServerEventSchema,
  sameTurn,
  type Receipt,
  type TurnIdentity,
  type StoryInteraction,
  type FrozenTurn,
  type MessageAttempt,
} from '@mira/protocol';
import { ApiClient, ApiError } from '../api/client.js';
import { readSse } from '../api/sse.js';
import type { PlaybackScheduler } from '../playback/scheduler.js';
import type { InteractiveState } from './state.js';
import { acquireMicrophone, RecordingController } from './recorder.js';
import { ReceiptBook } from './receipts.js';
import type { ActiveRecovery } from '../persistence/browser.js';
import type { OutgoingMessage } from './messages.js';

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
  private browserLoaded = false;
  private recoveryCancellation?: FrozenTurn;
  private savedPresentation?: ActiveRecovery['presentation'];
  private removeStorageListener?: () => void;

  constructor(
    private readonly api: ApiClient,
    private readonly playback: PlaybackScheduler,
    private readonly store: InteractiveState,
  ) {
    this.removeStorageListener = api.persistence?.onReplacement(() => {
      if (this.disposed) return;
      this.connectionLost();
      this.automaticRecoveryBlocked = true;
      this.store.failure = '这次会话已在其他页面打开，请关闭其他页面后重新连接。';
    });
  }

  /** Called after scheduler-owned view updates; never serializes scene projections or media. */
  checkpointBrowser(): void {
    if (this.disposed || !this.api.persistence?.ownsSession()) return;
    const session = this.api.credentials();
    if (!session || this.store.sessionExpired) return;
    if (
      this.store.connected &&
      this.store.playback === 'idle' &&
      this.store.interaction === 'idle' &&
      (this.store.suggestions.length || (this.generation === 0 && this.store.opening))
    )
      this.savedPresentation = {
        revision: this.store.story.revision,
        suggestions: this.store.suggestions,
        opening: this.store.opening,
      };
    const activeTurn = this.current
      ? this.receipts.snapshot(this.current)
      : this.recoveryCancellation;
    this.api.persistence.saveRecovery({
      status: 'active',
      session,
      scenarioVersion: this.api.persistence.scenario.version,
      generation: this.generation,
      pending: this.receipts.outbox(),
      frozenTurns: this.receipts.snapshots().filter((turn) => turn.turnId !== activeTurn?.turnId),
      outgoing: this.store.outgoing,
      ...(activeTurn ? { activeTurn } : {}),
      ...(this.savedPresentation ? { presentation: this.savedPresentation } : {}),
    });
  }

  private expireBrowserSession(): void {
    this.store.connected = false;
    this.store.sessionExpired = true;
    this.sessionId = '';
    this.api.clear();
    this.api.persistence?.saveRecovery({ status: 'expired', outgoing: this.store.outgoing });
  }

  private ownsConnection(epoch: number): boolean {
    return (
      !this.disposed &&
      epoch === this.epoch &&
      (!this.api.persistence || this.api.persistence.ownsSession())
    );
  }

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
      if (!this.browserLoaded || !this.api.persistence?.ownsSession()) {
        const saved = this.api.persistence?.claimRecovery();
        this.browserLoaded = true;
        if (!reset && saved) {
          this.store.outgoing = saved.outgoing ?? [];
          if (
            saved.status === 'expired' ||
            saved.session.expiresAt <= Date.now() ||
            saved.scenarioVersion !== this.api.persistence?.scenario.version
          )
            throw new ApiError(
              'SESSION_EXPIRED',
              '上次会话已失效，本地对话和草稿仍保留，请重新开始。',
            );
          this.api.resume(saved.session);
          this.sessionId = saved.session.sessionId;
          this.generation = saved.generation;
          this.store.mode = saved.session.mode;
          this.receipts.restore(
            saved.pending,
            [...saved.frozenTurns, ...(saved.activeTurn ? [saved.activeTurn] : [])].slice(-8),
          );
          this.recoveryCancellation = saved.activeTurn;
          this.savedPresentation = saved.presentation;
          this.store.outgoing = saved.outgoing ?? [];
        }
      }
      if (reset) {
        this.api.persistence?.saveRecovery({ status: 'expired' });
        this.sessionId = '';
        this.recoveryCancellation = undefined;
        this.savedPresentation = undefined;
        this.receipts.clear();
        this.store.outgoing = [];
      }
      if (this.sessionId && !reset) {
        const cancelled = this.recoveryCancellation;
        if (cancelled) {
          try {
            await this.api.cancel(
              { ...cancelled, sessionId: this.sessionId },
              cancelled.receipts,
              signal,
            );
          } catch (error) {
            // A begin may never have reached the server before the page was closed.
            if (!(
              error instanceof ApiError &&
              error.code === 'STALE_TURN' &&
              !cancelled.receipts.length
            ))
              throw error;
          }
          if (!this.ownsConnection(epoch)) return;
          this.receipts.acknowledge(cancelled.receipts.map((receipt) => receipt.receiptId));
          if (this.recoveryCancellation === cancelled) this.recoveryCancellation = undefined;
          this.checkpointBrowser();
        }
        const pending = this.receipts.outbox();
        if (pending.length) {
          const acknowledged = await this.api.receipts(pending, signal);
          if (!this.ownsConnection(epoch)) return;
          this.receipts.acknowledge(acknowledged.acknowledged);
          this.checkpointBrowser();
        }
        const savedGeneration = this.generation;
        const snapshot = await this.api.snapshot(signal);
        if (!this.ownsConnection(epoch)) return;
        this.generation = Math.max(this.generation, snapshot.generation);
        this.reconcileMessages(snapshot.messageAttempts, snapshot.generation);
        this.store.voiceInput = snapshot.capabilities.voiceInput;
        this.store.scenario = snapshot.scene.scenario ?? null;
        this.store.environment = snapshot.scene.environment;
        this.store.facts = snapshot.scene.facts;
        if (snapshot.scene.story) this.store.story = snapshot.scene.story;
        const presentation = this.savedPresentation;
        if (
          presentation &&
          savedGeneration === snapshot.generation &&
          presentation.revision === this.store.story.revision
        ) {
          this.store.opening = presentation.opening;
          this.store.suggestions = presentation.suggestions;
        } else {
          this.savedPresentation = undefined;
          this.store.opening = null;
        }
      } else {
        this.api.clear();
        const session = await this.api.createSession(signal);
        if (!this.ownsConnection(epoch)) return;
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
      this.checkpointBrowser();
    } catch (error) {
      if (signal.aborted || !this.ownsConnection(epoch)) return;
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
      if (
        error instanceof ApiError &&
        ['SESSION_EXPIRED', 'UNAUTHORIZED', 'SCENE_MODULE_VERSION_MISMATCH'].includes(error.code)
      ) {
        this.expireBrowserSession();
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
    this.interrupt('connection');
    this.store.connected = false;
    this.store.connecting = false;
    if (
      !this.store.sessionExpired &&
      !this.automaticRecoveryBlocked &&
      Date.now() >= this.rateLimitedUntil
    )
      this.store.failure = '与服务端的连接已中断，正在自动重连。';
  }

  send(text: string): string | undefined {
    const clean = text.trim();
    if (!clean || !this.store.connected) return;
    void this.playback.unlock().catch(() => undefined);
    const messageId = crypto.randomUUID();
    const turn = this.start({ messageId, input: { text: clean }, visible: true });
    void this.submit(turn, clean);
    return messageId;
  }
  interact(interaction: StoryInteraction, visible = false): string | undefined {
    if (!this.store.connected) return;
    void this.playback.unlock().catch(() => undefined);
    const messageId = crypto.randomUUID();
    const turn = this.start({ messageId, input: { interaction }, visible });
    void this.submit(turn, { interaction });
    return messageId;
  }

  canRetry(messageId: string): boolean {
    const message = this.store.outgoing.find((entry) => entry.messageId === messageId);
    return (
      !!message &&
      !this.disposed &&
      !this.store.sessionExpired &&
      (!this.api.persistence || this.api.persistence.ownsSession()) &&
      this.store.outgoing.at(-1)?.messageId === messageId &&
      message.turn.sessionId === this.sessionId &&
      message.turn.generation === this.generation &&
      (message.status === 'failed' || message.status === 'interrupted') &&
      message.retryable &&
      !message.started &&
      !message.presented &&
      this.store.recording === 'idle' &&
      this.store.voicePreview === 'idle' &&
      this.store.interaction === 'idle' &&
      this.store.playback === 'idle'
    );
  }

  async retry(messageId: string): Promise<void> {
    if (this.store.retryingMessageId || !this.canRetry(messageId)) return;
    const sessionId = this.sessionId;
    this.store.retryingMessageId = messageId;
    try {
      // Reconcile cancellation, receipt acknowledgments and unknown transport outcomes first.
      await this.connect();
      if (!this.store.connected || this.sessionId !== sessionId || !this.canRetry(messageId))
        return;
      const message = this.store.outgoing.find((entry) => entry.messageId === messageId)!;
      if ('interaction' in message.input) {
        const interaction = message.input.interaction;
        if (
          interaction.kind === 'action' &&
          (interaction.revision !== this.store.story.revision ||
            !this.store.story.actions.some((action) => action.id === interaction.actionId))
        ) {
          this.updateMessage(message.turn, {
            retryable: false,
            error: '这里的选择已更新，请重新选择。',
          });
          return;
        }
      }
      void this.playback.unlock().catch(() => undefined);
      const turn = this.start({ messageId, input: message.input, visible: message.visible });
      void this.submit(turn, 'text' in message.input ? message.input.text : message.input);
    } finally {
      if (this.store.retryingMessageId === messageId) this.store.retryingMessageId = '';
    }
  }

  /** Scheduler notifications carry their execution owner, never infer completion from UI idle. */
  replyStarted(turn: TurnIdentity): void {
    if (this.isCurrent(turn)) this.updateMessage(turn, { status: 'responding', started: true });
  }
  replyCompleted(turn: TurnIdentity, success: boolean): void {
    if (!this.isCurrent(turn)) return;
    this.updateMessage(turn, {
      status: success ? 'completed' : 'interrupted',
      retryable: false,
      error: success ? '' : '场景呈现未完成，请继续对话。',
    });
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
    if (!this.isCurrent(turn)) return;
    this.interrupt('connection');
    this.updateMessage(turn, { error: '本次回复未完成，请重试或继续对话。' });
  }
  cancelRecording(): void {
    this.interrupt();
  }

  interrupt(reason: 'user' | 'connection' = 'user'): void {
    const previous = this.current;
    if (previous) {
      const message = this.store.outgoing.find((entry) => sameTurn(entry.turn, previous));
      if (message && ['sending', 'waiting', 'responding'].includes(message.status))
        this.updateMessage(previous, {
          status: reason === 'connection' && !message.started ? 'failed' : 'interrupted',
          retryable: reason === 'connection' && !message.started && !message.presented,
          error: reason === 'connection' ? '连接中断，本次回复未完成。' : '本次回复已停止。',
        });
    }
    this.current = undefined;
    this.store.activeMessageId = '';
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
      const cancelled: FrozenTurn = {
        generation: previous.generation,
        turnId: previous.turnId,
        receipts: snapshot,
      };
      this.recoveryCancellation = cancelled;
      this.checkpointBrowser();
      // Network cancellation is best effort; the next begin includes this frozen snapshot.
      void this.api
        .cancel(previous, snapshot)
        .then(() => {
          if (this.disposed || this.recoveryCancellation !== cancelled) return;
          this.recoveryCancellation = undefined;
          this.receipts.acknowledge(snapshot.map((receipt) => receipt.receiptId));
          this.checkpointBrowser();
        })
        .catch(() => undefined);
    }
  }
  discardVoicePreview(): void {
    this.interrupt();
  }

  receipt(value: Omit<Receipt, keyof TurnIdentity | 'receiptId'>, turn: TurnIdentity): void {
    if (!this.isCurrent(turn)) return;
    const receipt = { ...turn, ...value, receiptId: crypto.randomUUID() };
    if (!this.receipts.record(receipt)) return;
    if (value.status === 'presented') this.updateMessage(turn, { presented: true });
    this.checkpointBrowser();
    void this.flush();
  }
  async dispose(): Promise<void> {
    this.interrupt();
    this.checkpointBrowser();
    this.disposed = true;
    this.removeStorageListener?.();
    this.connection.abort();
    this.receipts.clear();
    this.api.clear();
    await this.playback.dispose();
  }
  private start(message?: Pick<OutgoingMessage, 'messageId' | 'input' | 'visible'>): TurnIdentity {
    this.interrupt();
    const turn = {
      sessionId: this.sessionId,
      generation: ++this.generation,
      turnId: crypto.randomUUID(),
    };
    this.current = turn;
    this.store.activeMessageId = message?.messageId ?? '';
    if (message)
      this.store.outgoing = [
        ...this.store.outgoing.filter((entry) => entry.messageId !== message.messageId).slice(-59),
        {
          ...message,
          turn,
          status: 'sending',
          started: false,
          presented: false,
          retryable: false,
          error: '',
        },
      ];
    this.recoveryCancellation = undefined;
    this.savedPresentation = undefined;
    this.checkpointBrowser();
    this.active = new AbortController();
    this.store.failure = '';
    this.store.transcribed = '';
    this.playback.begin(turn);
    this.begin = this.api
      .begin(
        turn,
        this.receipts.outbox(),
        this.receipts.snapshots(),
        this.active.signal,
        message?.messageId,
      )
      .then((response) => {
        if (!this.isCurrent(turn)) return;
        this.receipts.acknowledge(response.acknowledged);
        this.checkpointBrowser();
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
              this.updateMessage(turn, { status: 'waiting' });
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
    return (
      !this.disposed &&
      sameTurn(turn, this.current) &&
      !this.active.signal.aborted &&
      (!this.api.persistence || this.api.persistence.ownsSession())
    );
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
    const message = this.store.outgoing.find((entry) => sameTurn(entry.turn, turn));
    const failure =
      error instanceof ApiError
        ? error.message
        : error instanceof Error && error.message === 'SSE_IDLE_TIMEOUT'
          ? '回复等待超时，已停止本轮，可以重新发送消息。'
          : '这次回复未完成，未播放的内容已停止，可以重新发送消息。';
    this.interrupt();
    if (message)
      this.updateMessage(turn, {
        status: message.started || message.presented ? 'interrupted' : 'failed',
        retryable:
          !message.started &&
          !message.presented &&
          (!(error instanceof ApiError) || error.retryable || error.code === 'INTERNAL_ERROR'),
        error: failure,
      });
    const inline = message && ('text' in message.input || message.visible);
    this.store.failure = inline && !message.started && !message.presented ? '' : failure;
    if (error instanceof ApiError && error.code === 'STALE_TURN')
      void this.recoverConnection(true, true);
    if (error instanceof ApiError && ['SESSION_EXPIRED', 'UNAUTHORIZED'].includes(error.code)) {
      this.expireBrowserSession();
      this.store.failure = failure;
    }
  }

  private updateMessage(
    turn: TurnIdentity,
    update: Partial<
      Pick<OutgoingMessage, 'status' | 'started' | 'presented' | 'retryable' | 'error'>
    >,
  ): void {
    this.store.outgoing = this.store.outgoing.map((message) =>
      sameTurn(message.turn, turn) ? { ...message, ...update } : message,
    );
    this.checkpointBrowser();
  }

  private reconcileMessages(
    attempts: MessageAttempt[] | undefined,
    serverGeneration: number,
  ): void {
    this.store.outgoing = this.store.outgoing.map((message) => {
      if (message.turn.sessionId !== this.sessionId) return message;
      const attempt = attempts?.find(
        (entry) => sameTurn(entry, message.turn) && entry.messageId === message.messageId,
      );
      if (attempt?.status === 'completed')
        return { ...message, status: 'completed', presented: true, retryable: false, error: '' };
      if (message.status === 'completed') return message;
      if (attempt?.presented)
        return {
          ...message,
          status: 'interrupted',
          presented: true,
          retryable: false,
          error: attempt.error || '回复中断，请继续对话。',
        };
      const pending = ['sending', 'waiting', 'responding'].includes(message.status);
      return {
        ...message,
        status: message.started ? 'interrupted' : pending ? 'failed' : message.status,
        retryable:
          !message.started &&
          !message.presented &&
          message.turn.generation >= serverGeneration &&
          (pending || message.retryable) &&
          (attempt ? attempt.retryable : pending || message.retryable),
        error: attempt?.error || message.error || '本次回复未完成，请重试或继续对话。',
      };
    });
  }
  private async flush(): Promise<void> {
    if (this.flushing || this.disposed) return;
    this.flushing = true;
    try {
      while (this.receipts.outbox().length && !this.disposed) {
        const snapshot = this.receipts.outbox();
        const sessionId = this.sessionId;
        const book = this.receipts;
        const response = await this.api.receipts(snapshot);
        if (this.disposed || this.sessionId !== sessionId || this.receipts !== book) return;
        this.receipts.acknowledge(response.acknowledged);
        this.checkpointBrowser();
        if (!response.acknowledged.length) break;
      }
    } catch {
      /* The bounded outbox is retried atomically by the next begin. */
    } finally {
      this.flushing = false;
    }
  }
}
