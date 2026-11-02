// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageShare } from '@mira/protocol';
import { ApiClient, ApiError } from '../api/client.js';
import { MediaShareCoordinator } from './media-share-coordinator.js';
import { initialInteractiveState } from './state.js';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const share: ImageShare = {
  shareId: 'share',
  attemptId: 'attempt',
  version: 1,
  phase: 'preparing',
  originLabel: 'test',
  title: 'test',
  width: 1024,
  height: 1024,
  announcedAt: 1,
  expiresAt: 900000,
  simulated: true,
  canRetryGeneration: false,
  longWait: false,
};
const coordinators: MediaShareCoordinator[] = [];
function setup(query = vi.fn(async () => share)) {
  const state = initialInteractiveState();
  state.connected = true;
  state.animation = 'live2d';
  const deliver = vi.fn(async () => false);
  const coordinator = new MediaShareCoordinator(
    { imageShare: query } as unknown as ApiClient,
    state,
    deliver,
    () => undefined,
  );
  coordinators.push(coordinator);
  coordinator.setSession('session', [share]);
  return { state, query, deliver, coordinator };
}
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});
afterEach(() => {
  for (const c of coordinators.splice(0)) c.dispose();
  document.body.replaceChildren();
  vi.useRealTimers();
});
describe('bounded polling and independent idle delivery', () => {
  it('holds one request in flight and waits two seconds after completion before another query', async () => {
    const pending = deferred<ImageShare>();
    const h = setup(vi.fn(() => pending.promise));
    await vi.advanceTimersByTimeAsync(500);
    expect(h.query).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10000);
    expect(h.query).toHaveBeenCalledTimes(1);
    pending.resolve({ ...share, version: 2 });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1999);
    expect(h.query).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.query).toHaveBeenCalledTimes(2);
  });
  it('pauses queries while hidden or offline and backs off transport errors without marking generation failed', async () => {
    const h = setup(
      vi.fn().mockRejectedValue(new ApiError('NETWORK_UNAVAILABLE', 'offline', true)),
    );
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    await vi.advanceTimersByTimeAsync(500);
    expect(h.query).not.toHaveBeenCalled();
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.query).not.toHaveBeenCalled();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.query).toHaveBeenCalledTimes(1);
    expect(h.state.imageShares.share?.phase).toBe('preparing');
    expect(h.state.imageShares.share?.networkError).toBe(true);
    await vi.advanceTimersByTimeAsync(3999);
    expect(h.query).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.query).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(7999);
    expect(h.query).toHaveBeenCalledTimes(2);
  });
  it('ignores a delayed previous-session response and resumes polling the new session', async () => {
    const previous = deferred<ImageShare>();
    const query = vi
      .fn()
      .mockImplementationOnce(() => previous.promise)
      .mockResolvedValue({ ...share, shareId: 'new-share', attemptId: 'new-attempt', version: 3 });
    const h = setup(query);
    await vi.advanceTimersByTimeAsync(500);
    h.coordinator.setSession('new-session', [
      { ...share, shareId: 'new-share', attemptId: 'new-attempt' },
    ]);
    previous.resolve({ ...share, version: 100, phase: 'ready' });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.state.imageShares.share).toBeUndefined();
    expect(h.state.imageShares['new-share']?.version).toBe(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.state.imageShares['new-share']?.version).toBe(3);
  });
  it('allows a silent ready share with an empty focused composer and tries again only after a new idle cycle', async () => {
    const h = setup(vi.fn(async () => ({ ...share, phase: 'ready' as const, version: 2 })));
    const card = document.createElement('article');
    document.body.append(card);
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 10,
      top: 10,
      left: 10,
      right: 210,
      bottom: 160,
      width: 200,
      height: 150,
      toJSON: () => ({}),
    });
    h.coordinator.register('share', card);
    const preview = document.createElement('div');
    preview.className = 'image-share-preview';
    card.append(preview);
    vi.spyOn(preview, 'getBoundingClientRect').mockImplementation(() =>
      card.getBoundingClientRect(),
    );
    const composer = document.createElement('textarea');
    document.body.append(composer);
    composer.focus();
    await vi.advanceTimersByTimeAsync(500);
    expect(h.deliver).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4000);
    expect(h.deliver).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    await vi.advanceTimersByTimeAsync(2000);
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.deliver).toHaveBeenCalledTimes(2);
  });
  it('recognizes a real draft-edit idle cycle even when the edit and clear happen between polls', async () => {
    const h = setup(vi.fn(async () => ({ ...share, phase: 'ready' as const, version: 2 })));
    const card = document.createElement('article');
    document.body.append(card);
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 10,
      top: 10,
      left: 10,
      right: 210,
      bottom: 160,
      width: 200,
      height: 150,
      toJSON: () => ({}),
    });
    h.coordinator.register('share', card);
    const preview = document.createElement('div');
    preview.className = 'image-share-preview';
    card.append(preview);
    vi.spyOn(preview, 'getBoundingClientRect').mockImplementation(() =>
      card.getBoundingClientRect(),
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(h.deliver).toHaveBeenCalledTimes(1);
    h.coordinator.gate({ draft: true });
    h.coordinator.inputChanged();
    h.coordinator.gate({ draft: false });
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.deliver).toHaveBeenCalledTimes(2);
  });
  it('waits through actual pointer/key holds and then permits a still-focused retry button after cooldown', async () => {
    const h = setup(vi.fn(async () => ({ ...share, phase: 'ready' as const, version: 2 })));
    const card = document.createElement('article');
    document.body.append(card);
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 10,
      top: 10,
      left: 10,
      right: 210,
      bottom: 160,
      width: 200,
      height: 150,
      toJSON: () => ({}),
    });
    h.coordinator.register('share', card);
    const preview = document.createElement('div');
    preview.className = 'image-share-preview';
    card.append(preview);
    vi.spyOn(preview, 'getBoundingClientRect').mockImplementation(() =>
      card.getBoundingClientRect(),
    );
    const retry = document.createElement('button');
    document.body.append(retry);
    retry.focus();
    retry.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7 }));
    await vi.advanceTimersByTimeAsync(2500);
    expect(h.deliver).not.toHaveBeenCalled();
    retry.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.deliver).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(retry);
    retry.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Tab', code: 'Tab' }));
    await vi.advanceTimersByTimeAsync(4000);
    expect(h.deliver).toHaveBeenCalledTimes(1);
    retry.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Tab', code: 'Tab' }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.deliver).toHaveBeenCalledTimes(2);
  });
  it('keeps a ready image deferred when only its status is visible above a clipped preview', async () => {
    const h = setup(vi.fn(async () => ({ ...share, phase: 'ready' as const, version: 2 })));
    const pane = document.createElement('div');
    pane.setAttribute('role', 'log');
    const card = document.createElement('article');
    const preview = document.createElement('div');
    preview.className = 'image-share-preview';
    card.append(preview);
    pane.append(card);
    document.body.append(pane);
    h.coordinator.register('share', card);
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 200,
      top: 200,
      left: 0,
      right: 300,
      bottom: 350,
      width: 300,
      height: 150,
      toJSON: () => ({}),
    });
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 224,
      bottom: 300,
      width: 224,
      height: 300,
      toJSON: () => ({}),
    });
    vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 20,
      top: 20,
      left: 0,
      right: 202,
      bottom: 162,
      width: 202,
      height: 142,
      toJSON: () => ({}),
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(h.deliver).not.toHaveBeenCalled();
    expect(h.state.imageShares.share?.phase).toBe('ready');
  });
  it('does not acquire a manual media lease if newer user activity wins while the preview scroll settles', async () => {
    const h = setup();
    h.coordinator.setSession('session', [{ ...share, phase: 'ready', version: 2 }]);
    const pane = document.createElement('div');
    pane.setAttribute('role', 'log');
    const card = document.createElement('article');
    const preview = document.createElement('div');
    preview.className = 'image-share-preview';
    card.append(preview);
    pane.append(card);
    document.body.append(pane);
    h.coordinator.register('share', card);
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 200,
      top: 200,
      left: 0,
      right: 300,
      bottom: 350,
      width: 300,
      height: 150,
      toJSON: () => ({}),
    });
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 224,
      bottom: 300,
      width: 224,
      height: 300,
      toJSON: () => ({}),
    });
    vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 20,
      top: 20,
      left: 0,
      right: 202,
      bottom: 162,
      width: 202,
      height: 142,
      toJSON: () => ({}),
    });
    const viewing = h.coordinator.view('share');
    h.coordinator.inputChanged();
    await vi.advanceTimersByTimeAsync(100);
    await viewing;
    expect(h.deliver).not.toHaveBeenCalled();
  });
});
