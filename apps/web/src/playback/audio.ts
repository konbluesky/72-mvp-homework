export interface PreparedAudio {
  start(ended: () => void, energy: (value: number) => void): () => void;
}
export interface AudioPort {
  unlock(): Promise<void>;
  prepare(path: string, signal: AbortSignal): Promise<PreparedAudio>;
  dispose(): Promise<void>;
}

export class BrowserAudio implements AudioPort {
  private context?: AudioContext;
  private activeStop?: () => void;
  constructor(
    private readonly download: (path: string, signal: AbortSignal) => Promise<ArrayBuffer>,
    private readonly timing?: (name: string, durationMs: number) => void,
  ) {}
  async unlock(): Promise<void> {
    this.context ??= new AudioContext();
    if (this.context.state === 'suspended') await this.context.resume();
    if (this.context.state !== 'running') throw new Error('AUDIO_BLOCKED');
  }
  async prepare(path: string, signal: AbortSignal): Promise<PreparedAudio> {
    if (!this.context) throw new Error('AUDIO_LOCKED');
    const context = this.context;
    const downloadAt = performance.now();
    const bytes = await this.download(path, signal);
    signal.throwIfAborted();
    this.timing?.('media-download', performance.now() - downloadAt);
    const decodeAt = performance.now();
    const buffer = await context.decodeAudioData(bytes);
    signal.throwIfAborted();
    this.timing?.('media-decode', performance.now() - decodeAt);
    if (!buffer.length || buffer.duration > 45) throw new Error('AUDIO_INVALID');
    return {
      start: (ended, energy) => {
        // The preparation budget ends at decode. Playback has its own turn owner.
        if (context.state !== 'running') throw new Error('AUDIO_BLOCKED');
        this.activeStop?.();
        const source = context.createBufferSource();
        const gain = context.createGain();
        const analyser = context.createAnalyser();
        // Average a speech-sized window instead of following individual waveform fluctuations.
        analyser.fftSize = 2048;
        const samples = new Float32Array(analyser.fftSize);
        source.buffer = buffer;
        source.connect(analyser).connect(gain).connect(context.destination);
        let frame = 0;
        let stopped = false;
        let envelope = 0;
        let measuredAt = context.currentTime;
        const cleanup = () => {
          cancelAnimationFrame(frame);
          source.onended = null;
          source.buffer = null;
          if (this.activeStop === stop) this.activeStop = undefined;
          source.disconnect();
          analyser.disconnect();
          gain.disconnect();
          envelope = 0;
          energy(0);
        };
        const stop = () => {
          if (stopped) return;
          stopped = true;
          gain.gain.setValueAtTime(0, context.currentTime);
          source.stop();
          cleanup();
        };
        const measure = () => {
          if (stopped) {
            stop();
            return;
          }
          analyser.getFloatTimeDomainData(samples);
          const rms = Math.sqrt(
            samples.reduce((sum, value) => sum + value * value, 0) / samples.length,
          );
          const now = context.currentTime;
          const elapsed = Math.max(0, Math.min(0.1, now - measuredAt));
          measuredAt = now;
          const target = rms < 0.008 ? 0 : Math.min(1, rms * 6);
          // Follow syllables with a softer release; stop/ended still close the mouth synchronously.
          const response = target > envelope ? 0.07 : 0.12;
          envelope += (target - envelope) * (1 - Math.exp(-elapsed / response));
          energy(envelope < 0.01 ? 0 : envelope);
          frame = requestAnimationFrame(measure);
        };
        source.onended = () => {
          if (stopped) return;
          stopped = true;
          cleanup();
          ended();
        };
        try {
          source.start();
        } catch (error) {
          stopped = true;
          cleanup();
          throw error;
        }
        frame = requestAnimationFrame(measure);
        this.activeStop = stop;
        return stop;
      },
    };
  }
  async dispose(): Promise<void> {
    this.activeStop?.();
    this.activeStop = undefined;
    const context = this.context;
    this.context = undefined;
    if (context && context.state !== 'closed') await context.close();
  }
}
