import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioReadyPayload, TurnIdentity } from '@mira/protocol';
import { PlaybackScheduler, type PlaybackView } from './scheduler.js';
import type { PreparedAudio } from './audio.js';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const turn = (generation: number): TurnIdentity => ({
  sessionId: 'session',
  generation,
  turnId: `turn${generation}`,
});
const segment = (id: string, events: AudioReadyPayload['events'] = []): AudioReadyPayload => ({
  segmentId: id,
  text: `句子 ${id}`,
  audioUrl: `/api/media/${id}`,
  emotion: 'curious',
  action: events.length ? 'offerPhoto' : 'none',
  events,
});
function harness() {
  const waiting = new Map<string, ReturnType<typeof deferred<PreparedAudio>>>();
  const ended = new Map<string, () => void>();
  const stops = new Map<string, ReturnType<typeof vi.fn>>();
  const starts = vi.fn();
  const receipt = vi.fn();
  const photo = vi.fn(async (): Promise<void> => undefined);
  const environment = vi.fn(async (): Promise<void> => undefined);
  const failure = vi.fn();
  const view: Partial<PlaybackView> = {};
  const prepare = vi.fn((path: string) => {
    const request = deferred<PreparedAudio>();
    waiting.set(path, request);
    return request.promise;
  });
  const scheduler = new PlaybackScheduler({
    audio: { prepare, unlock: async () => undefined, dispose: async () => undefined },
    presentation: { photo, environment, clear: vi.fn() },
    view: (next) => Object.assign(view, next),
    receipt,
    failure,
  });
  const ready = (id: string, throws = false) => {
    waiting.get(`/api/media/${id}`)?.resolve({
      start(done) {
        if (throws) throw new Error('PLAY_FAILED');
        starts(id);
        ended.set(id, done);
        const stop = vi.fn();
        stops.set(id, stop);
        return stop;
      },
    });
  };
  return {
    scheduler,
    waiting,
    ended,
    stops,
    starts,
    receipt,
    photo,
    environment,
    failure,
    view,
    prepare,
    ready,
  };
}
const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
afterEach(() => vi.useRealTimers());
describe('single playback scheduler', () => {
  it('removes the abort listener even when native audio start throws', async () => {
    const h = harness();
    h.scheduler.begin(turn(1));
    const add = vi.spyOn(AbortSignal.prototype, 'addEventListener');
    const remove = vi.spyOn(AbortSignal.prototype, 'removeEventListener');
    h.scheduler.enqueue(turn(1), segment('one'));
    h.ready('one', true);
    await tick();
    const registered = add.mock.calls.filter((call) => call[0] === 'abort').map((call) => call[1]);
    const removed = remove.mock.calls.filter((call) => call[0] === 'abort').map((call) => call[1]);
    expect(registered.length).toBeGreaterThan(0);
    for (const listener of registered) expect(removed).toContain(listener);
    add.mockRestore();
    remove.mockRestore();
    h.scheduler.cancel();
  });

  it('discards old decode completion and never revives its caption or audio', async () => {
    const h = harness();
    h.scheduler.begin(turn(1));
    h.scheduler.enqueue(turn(1), segment('old'));
    h.scheduler.begin(turn(2));
    h.ready('old');
    await tick();
    expect(h.starts).not.toHaveBeenCalled();
    expect(h.view.subtitle).toBe('');
    expect(h.receipt).not.toHaveBeenCalled();
    h.scheduler.cancel();
  });
  it('stops synchronously and ignores an old onended after a new turn starts', async () => {
    const h = harness();
    h.scheduler.begin(turn(1));
    h.scheduler.enqueue(turn(1), segment('old'));
    h.ready('old');
    await tick();
    expect(h.view.interaction).toBe('speaking');
    h.scheduler.begin(turn(2));
    expect(h.stops.get('old')).toHaveBeenCalledOnce();
    h.ended.get('old')?.();
    await tick();
    expect(h.receipt).not.toHaveBeenCalled();
    expect(h.view.subtitle).toBe('');
    h.scheduler.cancel();
  });
  it('normal generation completion permits queued audio to play and commits only onended', async () => {
    const h = harness();
    h.scheduler.begin(turn(1));
    h.scheduler.enqueue(turn(1), segment('one'));
    h.scheduler.generationDone(turn(1));
    h.ready('one');
    await tick();
    expect(h.view.interaction).toBe('speaking');
    expect(h.receipt).not.toHaveBeenCalled();
    h.ended.get('one')?.();
    await tick();
    expect(h.receipt.mock.calls[0]?.[0]).toMatchObject({
      targetId: 'one',
      status: 'presented',
      mode: 'audio',
    });
    expect(h.view.interaction).toBe('idle');
    h.scheduler.cancel();
  });
  it('does not publish visuals or speaking when audio start throws', async () => {
    const h = harness();
    h.scheduler.begin(turn(1));
    h.scheduler.enqueue(
      turn(1),
      segment('one', [{ type: 'photo', eventId: 'photo1', resourceId: 'travel_photo_01' }]),
    );
    h.ready('one', true);
    await tick();
    expect(h.photo).not.toHaveBeenCalled();
    expect(h.view.interaction).toBe('idle');
    expect(h.view.playback).toBe('audio-error');
    expect(h.receipt).not.toHaveBeenCalled();
    h.scheduler.cancel();
  });
  it('failed photo never becomes a presented fact and blocks environment across sentences', async () => {
    const h = harness();
    h.photo.mockRejectedValue(new Error('decode failed'));
    h.scheduler.begin(turn(1));
    h.scheduler.enqueue(
      turn(1),
      segment('one', [{ type: 'photo', eventId: 'photo1', resourceId: 'travel_photo_01' }]),
    );
    h.scheduler.enqueue(
      turn(1),
      segment('two', [{ type: 'environment', eventId: 'rain1', environment: 'rain-soft' }]),
    );
    h.ready('one');
    h.ready('two');
    await tick();
    h.ended.get('one')?.();
    await tick();
    expect(h.environment).not.toHaveBeenCalled();
    expect(h.receipt.mock.calls.map((call) => call[0])).toContainEqual({
      targetId: 'photo1',
      kind: 'photo',
      status: 'failed',
    });
    expect(h.receipt.mock.calls.map((call) => call[0])).not.toContainEqual({
      targetId: 'photo1',
      kind: 'photo',
      status: 'presented',
    });
    h.scheduler.cancel();
  });
  it('bounds prefetch to one successor and advances after actual completion', async () => {
    const h = harness();
    h.scheduler.begin(turn(1));
    for (const id of ['one', 'two', 'three']) h.scheduler.enqueue(turn(1), segment(id));
    expect(h.prepare).toHaveBeenCalledTimes(2);
    h.ready('one');
    h.ready('two');
    await tick();
    h.ended.get('one')?.();
    await tick();
    expect(h.prepare).toHaveBeenCalledTimes(3);
    h.scheduler.cancel();
  });
  it('subtitle fallback requires explicit per-sentence confirmation without speaking', async () => {
    const h = harness();
    h.scheduler.begin(turn(1));
    h.scheduler.enqueue(turn(1), segment('one'));
    h.ready('one', true);
    await tick();
    await h.scheduler.useText();
    expect(h.view.playback).toBe('text');
    expect(h.view.interaction).toBe('idle');
    expect(h.view.subtitle).toBe('句子 one');
    expect(h.receipt).not.toHaveBeenCalled();
    await h.scheduler.continueText();
    expect(h.receipt.mock.calls[0]?.[0]).toMatchObject({ status: 'presented', mode: 'text' });
    h.scheduler.cancel();
  });
  it('late image completion after cancellation cannot commit its fact', async () => {
    const h = harness();
    const image = deferred<void>();
    h.photo.mockImplementation(() => image.promise);
    h.scheduler.begin(turn(1));
    h.scheduler.enqueue(
      turn(1),
      segment('one', [{ type: 'photo', eventId: 'photo1', resourceId: 'travel_photo_01' }]),
    );
    h.ready('one');
    await tick();
    h.scheduler.begin(turn(2));
    image.resolve();
    await tick();
    expect(h.receipt).not.toHaveBeenCalled();
    h.scheduler.cancel();
  });
});
