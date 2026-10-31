import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecordingController, type CaptureLease, type RecorderPort } from './recorder.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function harness() {
  const request = deferred<CaptureLease>();
  const stopTracks = vi.fn();
  let callbacks: Parameters<CaptureLease['recorder']>[0] | undefined;
  const port: RecorderPort = { mimeType: 'audio/webm', start: vi.fn(), stop: vi.fn() };
  const lease: CaptureLease = {
    stop: stopTracks,
    recorder: vi.fn((value) => {
      callbacks = value;
      return port;
    }),
  };
  let now = 0;
  let current = true;
  let visible = true;
  const submit = vi.fn();
  const phase = vi.fn();
  const fail = vi.fn();
  const controller = new RecordingController({
    acquire: () => request.promise,
    isCurrent: () => current,
    visible: () => visible,
    now: () => now,
    phase,
    submit,
    fail,
  });
  return {
    request,
    lease,
    stopTracks,
    port,
    submit,
    phase,
    fail,
    controller,
    callbacks: () => callbacks,
    time: (value: number) => {
      now = value;
    },
    hide: () => {
      visible = false;
    },
    invalidate: () => {
      current = false;
    },
  };
}
afterEach(() => vi.useRealTimers());
describe('recording intent ownership', () => {
  it('has a separate permission budget and stops streams granted after that budget', async () => {
    vi.useFakeTimers();
    const h = harness();
    const press = h.controller.press();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.fail).toHaveBeenCalledWith('麦克风授权等待太久了，可以重新按住说话，或先打字。');
    h.request.resolve(h.lease);
    await press;
    expect(h.stopTracks).toHaveBeenCalledOnce();
    expect(h.port.start).not.toHaveBeenCalled();
  });

  it('release while permission is pending never starts recording and stops every returned track', async () => {
    const h = harness();
    const press = h.controller.press();
    h.controller.release();
    h.request.resolve(h.lease);
    await press;
    expect(h.stopTracks).toHaveBeenCalledOnce();
    expect(h.port.start).not.toHaveBeenCalled();
    expect(h.submit).not.toHaveBeenCalled();
  });
  it.each(['hide', 'invalidate'] as const)(
    'ignores a late acquisition after %s',
    async (action) => {
      const h = harness();
      const press = h.controller.press();
      h[action]();
      h.request.resolve(h.lease);
      await press;
      expect(h.stopTracks).toHaveBeenCalledOnce();
      expect(h.port.start).not.toHaveBeenCalled();
    },
  );
  it('records actual chunks and MIME, stops tracks on release, and submits only once stopped', async () => {
    const h = harness();
    const press = h.controller.press();
    h.request.resolve(h.lease);
    await press;
    h.time(900);
    h.callbacks()?.chunk(new Blob(['audio'], { type: 'audio/webm' }));
    h.controller.release();
    expect(h.port.stop).toHaveBeenCalledOnce();
    expect(h.stopTracks).toHaveBeenCalled();
    expect(h.submit).not.toHaveBeenCalled();
    h.callbacks()?.stopped();
    expect(h.submit).toHaveBeenCalledOnce();
    expect(h.submit.mock.calls[0]?.[0].type).toBe('audio/webm');
    expect(h.submit.mock.calls[0]?.[1]).toBe(900);
  });
  it('freezes duration on release even when the final recorder callback arrives late', async () => {
    const h = harness();
    const press = h.controller.press();
    h.request.resolve(h.lease);
    await press;
    h.time(15_000);
    h.controller.release();
    h.time(15_350);
    h.callbacks()?.chunk(new Blob(['audio']));
    h.callbacks()?.stopped();
    expect(h.submit).toHaveBeenCalledOnce();
    expect(h.submit.mock.calls[0]?.[1]).toBe(15_000);
  });
  it('discards chunks and stop callback after cancellation', async () => {
    const h = harness();
    const press = h.controller.press();
    h.request.resolve(h.lease);
    await press;
    h.controller.cancel();
    h.time(800);
    h.callbacks()?.chunk(new Blob(['audio']));
    h.callbacks()?.stopped();
    expect(h.submit).not.toHaveBeenCalled();
    expect(h.stopTracks).toHaveBeenCalled();
  });
  it('rejects oversize recording and enforces the 15 second release', async () => {
    vi.useFakeTimers();
    const h = harness();
    const press = h.controller.press();
    h.request.resolve(h.lease);
    await press;
    h.time(15_000);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(h.port.stop).toHaveBeenCalledOnce();
    h.callbacks()?.chunk(new Blob([new Uint8Array(4_194_305)]));
    expect(h.fail).toHaveBeenCalledWith('录音太大了，请缩短后重试。');
    h.callbacks()?.stopped();
    expect(h.submit).not.toHaveBeenCalled();
  });
});
