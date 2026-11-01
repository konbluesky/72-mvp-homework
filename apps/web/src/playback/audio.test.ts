import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserAudio } from './audio.js';

class FakeNode {
  disconnect = vi.fn();
  connect<T>(target: T): T {
    return target;
  }
}
class FakeSource extends FakeNode {
  buffer: unknown;
  onended: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
}
class FakeAnalyser extends FakeNode {
  fftSize = 0;
  getFloatTimeDomainData(values: Float32Array) {
    values.fill(0.1);
  }
}
class FakeGain extends FakeNode {
  gain = { setValueAtTime: vi.fn() };
}
class FakeContext {
  static instances: FakeContext[] = [];
  state = 'running';
  currentTime = 0;
  destination = {};
  source = new FakeSource();
  analyser = new FakeAnalyser();
  gain = new FakeGain();
  constructor() {
    FakeContext.instances.push(this);
  }
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  decodeAudioData = vi.fn(async () => ({ length: 1_000, duration: 20 }));
  createBufferSource() {
    return this.source;
  }
  createGain() {
    return this.gain;
  }
  createAnalyser() {
    return this.analyser;
  }
}
let frame: FrameRequestCallback | undefined;
beforeEach(() => {
  FakeContext.instances = [];
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());
describe('Web Audio resource boundary', () => {
  it('ends preparation budget after decode and measures real sample energy during playback', async () => {
    const audio = new BrowserAudio(async () => new ArrayBuffer(10));
    await audio.unlock();
    const preparation = new AbortController();
    const clip = await audio.prepare('/api/media/one', preparation.signal);
    preparation.abort(new Error('Preparation budget expired after success'));
    const ended = vi.fn();
    const energy = vi.fn();
    const stop = clip.start(ended, energy);
    const context = FakeContext.instances[0];
    expect(context?.source.start).toHaveBeenCalledOnce();
    if (!context) throw new Error('Missing audio context');
    context.currentTime = 0.08;
    frame?.(80);
    const first = energy.mock.lastCall?.[0] as number;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.6);
    context.currentTime = 0.16;
    frame?.(160);
    expect(energy.mock.lastCall?.[0]).toBeGreaterThan(first);
    expect(energy.mock.lastCall?.[0]).toBeLessThan(0.6);
    context?.source.onended?.();
    expect(energy.mock.lastCall?.[0]).toBe(0);
    expect(ended).toHaveBeenCalledOnce();
    expect(context?.source.buffer).toBeNull();
    expect(context?.analyser.disconnect).toHaveBeenCalledOnce();
    stop();
    expect(context?.source.stop).not.toHaveBeenCalled();
    await audio.dispose();
  });
  it('stops and mutes synchronously, removes callbacks and disconnects every audio node', async () => {
    const audio = new BrowserAudio(async () => new ArrayBuffer(10));
    await audio.unlock();
    const clip = await audio.prepare('/api/media/one', new AbortController().signal);
    const ended = vi.fn();
    const stop = clip.start(ended, vi.fn());
    const context = FakeContext.instances[0];
    stop();
    expect(context?.source.stop).toHaveBeenCalledOnce();
    expect(context?.gain.gain.setValueAtTime).toHaveBeenCalledWith(0, 0);
    expect(context?.source.onended).toBeNull();
    expect(context?.source.disconnect).toHaveBeenCalledOnce();
    expect(ended).not.toHaveBeenCalled();
    await audio.dispose();
    expect(context?.close).toHaveBeenCalledOnce();
  });
  it('cleans constructed nodes if native source.start throws', async () => {
    const audio = new BrowserAudio(async () => new ArrayBuffer(10));
    await audio.unlock();
    const clip = await audio.prepare('/api/media/one', new AbortController().signal);
    const context = FakeContext.instances[0];
    context?.source.start.mockImplementation(() => {
      throw new Error('START_FAILED');
    });
    expect(() => clip.start(vi.fn(), vi.fn())).toThrow('START_FAILED');
    expect(context?.source.disconnect).toHaveBeenCalledOnce();
    expect(context?.gain.disconnect).toHaveBeenCalledOnce();
    expect(context?.analyser.disconnect).toHaveBeenCalledOnce();
    await audio.dispose();
  });
});
