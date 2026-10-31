export type RecordingPhase = 'idle' | 'permission' | 'recording';
export interface RecorderPort {
  readonly mimeType: string;
  start(): void;
  stop(): void;
}
export interface CaptureLease {
  stop(): void;
  recorder(callbacks: {
    chunk: (blob: Blob) => void;
    stopped: () => void;
    failed: () => void;
  }): RecorderPort;
}
export interface RecordingOptions {
  acquire(): Promise<CaptureLease>;
  isCurrent(): boolean;
  visible(): boolean;
  phase(value: RecordingPhase): void;
  submit(blob: Blob, durationMs: number): void;
  fail(message: string): void;
  now?: () => number;
  maxMs?: number;
  maxBytes?: number;
  permissionMs?: number;
}

/** A press has its own identity, even before microphone permission resolves. */
export class RecordingController {
  private intent = 0;
  private held = false;
  private lease?: CaptureLease;
  private recorder?: RecorderPort;
  private timer?: ReturnType<typeof setTimeout>;
  private permissionTimer?: ReturnType<typeof setTimeout>;
  private startedAt = 0;
  private stoppedAt?: number;
  private phase: RecordingPhase = 'idle';
  private now: () => number;

  constructor(private readonly options: RecordingOptions) {
    this.now = options.now ?? (() => performance.now());
  }

  async press(): Promise<void> {
    if (this.held) return;
    this.cancel();
    const intent = ++this.intent;
    this.held = true;
    this.setPhase('permission');
    this.permissionTimer = setTimeout(() => {
      if (intent !== this.intent || this.phase !== 'permission') return;
      this.cancel();
      this.options.fail('麦克风授权等待太久了，可以重新按住说话，或先打字。');
    }, this.options.permissionMs ?? 30_000);
    try {
      const lease = await this.options.acquire();
      if (!this.valid(intent) || !this.held) {
        lease.stop();
        return;
      }
      clearTimeout(this.permissionTimer);
      this.lease = lease;
      const chunks: Blob[] = [];
      let bytes = 0;
      const recorder = lease.recorder({
        chunk: (blob) => {
          if (intent !== this.intent) return;
          bytes += blob.size;
          if (bytes > (this.options.maxBytes ?? 4_194_304)) {
            this.cancel();
            this.options.fail('录音太大了，请缩短后重试。');
          } else chunks.push(blob);
        },
        stopped: () => {
          lease.stop();
          if (!this.valid(intent)) return;
          const durationMs = Math.min(
            this.options.maxMs ?? 15_000,
            Math.round((this.stoppedAt ?? this.now()) - this.startedAt),
          );
          this.releaseResources();
          const blob = new Blob(chunks, { type: recorder.mimeType });
          if (durationMs < 300 || blob.size === 0) {
            this.options.fail('没有听到完整的一句话，请再按住说一次。');
            return;
          }
          this.options.submit(blob, durationMs);
        },
        failed: () => {
          lease.stop();
          if (intent !== this.intent) return;
          this.cancel();
          this.options.fail('录音暂时不可用，可以先打字。');
        },
      });
      this.recorder = recorder;
      this.startedAt = this.now();
      recorder.start();
      this.setPhase('recording');
      // Leave room for the final encoded chunk; the server checks decoded duration independently.
      this.timer = setTimeout(
        () => this.release(),
        Math.max(0, (this.options.maxMs ?? 15_000) - 250),
      );
    } catch {
      if (intent !== this.intent) return;
      this.cancel();
      this.options.fail('无法使用麦克风，请检查权限，或先用文字聊聊。');
    }
  }

  release(): void {
    this.held = false;
    if (this.phase === 'permission') {
      this.cancel();
      return;
    }
    if (this.phase !== 'recording') return;
    this.stoppedAt = this.now();
    clearTimeout(this.timer);
    this.recorder?.stop();
    this.lease?.stop();
    this.setPhase('idle');
  }

  cancel(): void {
    this.intent += 1;
    this.held = false;
    this.recorder?.stop();
    this.lease?.stop();
    this.releaseResources();
  }

  private valid(intent: number): boolean {
    return intent === this.intent && this.options.isCurrent() && this.options.visible();
  }
  private setPhase(phase: RecordingPhase): void {
    this.phase = phase;
    this.options.phase(phase);
  }
  private releaseResources(): void {
    clearTimeout(this.timer);
    clearTimeout(this.permissionTimer);
    this.lease = undefined;
    this.recorder = undefined;
    this.stoppedAt = undefined;
    this.setPhase('idle');
  }
}

export async function acquireMicrophone(): Promise<CaptureLease> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
    throw new Error('MIC_UNAVAILABLE');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
    video: false,
  });
  return {
    stop: () => stream.getTracks().forEach((track) => track.stop()),
    recorder: (callbacks) => {
      const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(
        (type) => MediaRecorder.isTypeSupported(type),
      );
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size) callbacks.chunk(event.data);
      });
      recorder.addEventListener('stop', callbacks.stopped, { once: true });
      recorder.addEventListener('error', callbacks.failed, { once: true });
      return {
        mimeType: recorder.mimeType,
        start: () => recorder.start(250),
        stop: () => {
          if (recorder.state !== 'inactive') recorder.stop();
        },
      };
    },
  };
}
