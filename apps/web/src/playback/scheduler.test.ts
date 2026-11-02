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
  const presented = vi.fn();
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
    presented,
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
    presented,
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
  it('removes unconfirmed narration when a pending milestone is interrupted', async () => {
    const pending = deferred<void>();
    const view: Partial<PlaybackView> = {};
    const receipt = vi.fn();
    const scheduler = new PlaybackScheduler({
      audio: {
        prepare: async () => ({ start: () => () => undefined }),
        unlock: async () => undefined,
        dispose: async () => undefined,
      },
      presentation: {
        photo: async () => undefined,
        environment: async () => undefined,
        execute: () => pending.promise,
        clear: () => undefined,
      },
      view: (next) => Object.assign(view, next),
      receipt,
      failure: vi.fn(),
    });
    scheduler.begin(turn(1));
    scheduler.enqueuePresentation(turn(1), {
      presentationId: 'p',
      caption: '尚未确认的剧情回应',
      events: [{ type: 'beat', beatId: 'pending', eventId: 'e' }],
    });
    await tick();
    scheduler.cancel();
    pending.resolve();
    await tick();
    expect(view.narration).toBe('');
    expect(receipt).not.toHaveBeenCalled();
  });
  it('keeps generated suggestions hidden until all audio and visual presentation completes', async () => {
    const h = harness();
    const visual = deferred<void>();
    h.photo.mockImplementationOnce(() => visual.promise);
    const choices = [{ label: '聊聊海边', draft: '那片海对你有什么特别的意义？' }];
    h.scheduler.begin(turn(1));
    h.scheduler.enqueue(
      turn(1),
      segment('one', [{ type: 'photo', eventId: 'photo1', resourceId: 'travel_photo_01' }]),
    );
    h.scheduler.generationDone(turn(1), choices);
    h.ready('one');
    await tick();
    expect(h.view.suggestions).toEqual([]);
    h.ended.get('one')?.();
    await tick();
    expect(h.view.suggestions).toEqual([]);
    expect(h.presented).not.toHaveBeenCalled();
    visual.resolve();
    await tick();
    expect(h.view.suggestions).toEqual(choices);
    expect(h.presented).toHaveBeenCalledExactlyOnceWith(turn(1), true);
    h.scheduler.generationDone(turn(1), choices);
    expect(h.presented).toHaveBeenCalledTimes(1);
    h.scheduler.cancel();
    expect(h.view.suggestions).toEqual([]);
  });
  it('does not revive suggestions from an interrupted turn or a late generation-done event', async () => {
    const h = harness();
    const choices = [{ label: '继续聊', draft: '后来发生了什么？' }];
    h.scheduler.begin(turn(1));
    h.scheduler.enqueue(turn(1), segment('old'));
    h.scheduler.generationDone(turn(1), choices);
    h.ready('old');
    await tick();
    h.scheduler.begin(turn(2));
    h.ended.get('old')?.();
    h.scheduler.generationDone(turn(1), choices);
    await tick();
    expect(h.view.suggestions).toEqual([]);
    expect(h.presented).not.toHaveBeenCalled();
    h.scheduler.cancel();
  });
  it('withholds recommendations after a visual event fails even when its sentence finishes', async () => {
    const h = harness();
    h.photo.mockRejectedValueOnce(new Error('PHOTO_FAILED'));
    h.scheduler.begin(turn(1));
    h.scheduler.enqueue(
      turn(1),
      segment('one', [{ type: 'photo', eventId: 'photo1', resourceId: 'travel_photo_01' }]),
    );
    h.scheduler.generationDone(turn(1), [{ label: '继续聊', draft: '能说说这次旅行吗？' }]);
    h.ready('one');
    await tick();
    h.ended.get('one')?.();
    await tick();
    expect(h.view.playback).toBe('idle');
    expect(h.view.suggestions).toEqual([]);
    h.scheduler.cancel();
  });
  it('shows suggestions after explicit text confirmation rather than before the user continues', async () => {
    const h = harness();
    const choices = [{ label: '继续聊', draft: '你愿意再说一点吗？' }];
    h.scheduler.begin(turn(1));
    h.scheduler.enqueue(turn(1), segment('one'));
    h.scheduler.generationDone(turn(1), choices);
    h.waiting.get('/api/media/one')?.resolve({
      start: () => {
        throw new Error('BLOCKED');
      },
    });
    await tick();
    await h.scheduler.useText();
    expect(h.view.suggestions).toEqual([]);
    await h.scheduler.continueText();
    await tick();
    expect(h.view.suggestions).toEqual(choices);
    h.scheduler.cancel();
  });
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
  it('failed photo never becomes a fact and independent weather is not coupled to photos', async () => {
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
    expect(h.environment).toHaveBeenCalledOnce();
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

it('keeps a no-audio navigation pending after generation completion and ignores its late callback after cancellation', async () => {
  const pending = deferred<void>(),
    receipt = vi.fn(),
    view: Partial<PlaybackView> = {};
  const scheduler = new PlaybackScheduler({
    audio: { prepare: vi.fn(), unlock: async () => undefined, dispose: async () => undefined },
    presentation: {
      photo: async () => undefined,
      environment: async () => undefined,
      execute: () => pending.promise,
      clear: vi.fn(),
    },
    receipt,
    view: (next) => Object.assign(view, next),
    failure: vi.fn(),
  });
  scheduler.begin(turn(1));
  scheduler.enqueuePresentation(turn(1), {
    presentationId: 'navigation',
    caption: '来到吧台',
    events: [{ eventId: 'location', type: 'location', location: 'counter' }],
  });
  scheduler.generationDone(turn(1));
  expect(view.playback).toBe('buffering');
  scheduler.begin(turn(2));
  pending.resolve();
  await tick();
  expect(receipt).not.toHaveBeenCalled();
  expect(view.narration).toBe('');
  scheduler.cancel();
});

describe('independent image presentation receipts', () => {
  it('prepares the image and introduction before showing, and does not infer an image receipt from audio', async () => {
    const h = harness();
    const image = deferred<void>();
    const shown = vi.fn(async () => undefined);
    h.scheduler.setImages({
      pending: async () => undefined,
      prepare: () => image.promise,
      ready: shown,
    });
    h.scheduler.begin(turn(1));
    h.scheduler.enqueueImageReady(turn(1), {
      shareId: 'share',
      version: 1,
      imageEventId: 'image',
      assetId: 'asset',
      introduction: segment('intro'),
    });
    h.scheduler.generationDone(turn(1));
    await tick();
    expect(shown).not.toHaveBeenCalled();
    h.ready('intro');
    await tick();
    expect(shown).not.toHaveBeenCalled();
    image.resolve();
    await tick();
    expect(shown).toHaveBeenCalledTimes(1);
    expect(h.receipt).toHaveBeenCalledWith(
      { targetId: 'image', kind: 'image', status: 'presented' },
      turn(1),
    );
    expect(h.receipt).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'segment', status: 'presented' }),
      turn(1),
    );
    h.ended.get('intro')?.();
    await tick();
    h.scheduler.cancel();
  });
  it('does not display or receipt a late download after user interruption', async () => {
    const h = harness();
    const image = deferred<void>();
    const shown = vi.fn(async () => undefined);
    h.scheduler.setImages({
      pending: async () => undefined,
      prepare: () => image.promise,
      ready: shown,
    });
    h.scheduler.begin(turn(1));
    h.scheduler.enqueueImageReady(turn(1), {
      shareId: 'share',
      version: 1,
      imageEventId: 'image',
      assetId: 'asset',
      introduction: segment('intro'),
    });
    h.ready('intro');
    h.scheduler.cancel();
    image.resolve();
    await tick();
    expect(shown).not.toHaveBeenCalled();
    expect(h.receipt).not.toHaveBeenCalled();
  });
});

it('retires both issued targets when an image unit cannot load, without replaying its introduction', async () => {
  const h = harness();
  h.scheduler.setImages({
    pending: async () => undefined,
    prepare: async () => {
      throw new Error('DOWNLOAD_FAILED');
    },
    ready: async () => undefined,
  });
  h.scheduler.begin(turn(1));
  h.scheduler.enqueueImageReady(turn(1), {
    shareId: 'share',
    version: 1,
    imageEventId: 'image',
    assetId: 'same-asset',
    introduction: segment('intro'),
  });
  h.ready('intro');
  h.scheduler.generationDone(turn(1));
  await tick();
  expect(h.receipt).toHaveBeenCalledWith(
    { targetId: 'image', kind: 'image', status: 'failed' },
    turn(1),
  );
  expect(h.receipt).toHaveBeenCalledWith(
    { targetId: 'intro', kind: 'segment', status: 'failed' },
    turn(1),
  );
  expect(h.starts).not.toHaveBeenCalled();
  h.scheduler.cancel();
});
