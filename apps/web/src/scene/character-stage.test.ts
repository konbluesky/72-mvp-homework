// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { CharacterFrame, CharacterRenderer } from './character.js';
const runtime = vi.hoisted(() => ({
  load: vi.fn<
    (
      canvas: HTMLCanvasElement,
      signal: AbortSignal,
      options?: { onFailure?: (error: Error) => void },
    ) => Promise<CharacterRenderer>
  >(),
}));
vi.mock('./live2d.js', () => ({ loadLive2D: runtime.load }));
import CharacterStage from './CharacterStage.vue';

const idle: CharacterFrame = {
  interaction: 'idle',
  emotion: 'guarded',
  action: 'none',
  mouthOpen: 0,
  photoInHand: false,
};
const renderer = () => ({
  update: vi.fn<(frame: CharacterFrame) => void>(),
  cancel: vi.fn(),
  dispose: vi.fn(),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  runtime.load.mockReset();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('Live2D stage ownership', () => {
  it('projects the current frame into a loaded real renderer without any SVG actor', async () => {
    const live = renderer();
    runtime.load.mockResolvedValue(live);
    const wrapper = mount(CharacterStage, { props: { frame: idle, environment: 'rain' } });
    await flushPromises();
    expect(wrapper.attributes('data-renderer')).toBe('live2d');
    expect(wrapper.find('canvas.live2d-canvas').exists()).toBe(true);
    expect(wrapper.find('svg').exists()).toBe(false);
    const speaking: CharacterFrame = {
      ...idle,
      interaction: 'speaking',
      emotion: 'relieved',
      action: 'offerPhoto',
      mouthOpen: 0.65,
    };
    await wrapper.setProps({ frame: speaking, environment: 'rain-soft' });
    expect(live.update).toHaveBeenLastCalledWith(speaking);
    expect(wrapper.attributes('data-weather')).toBe('rain-soft');
    await wrapper.setProps({ frame: idle });
    expect(live.cancel).toHaveBeenCalledOnce();
    expect(live.update).toHaveBeenLastCalledWith(idle);
    wrapper.unmount();
    expect(live.dispose).toHaveBeenCalledOnce();
  });
  it('destroys a late loader result after unmount without reviving the canvas', async () => {
    const pending = deferred<CharacterRenderer>();
    runtime.load.mockReturnValue(pending.promise);
    const wrapper = mount(CharacterStage, { props: { frame: idle, environment: 'rain' } });
    await flushPromises();
    const signal = runtime.load.mock.calls[0]?.[1];
    wrapper.unmount();
    expect(signal?.aborted).toBe(true);
    const late = renderer();
    pending.resolve(late);
    await flushPromises();
    expect(late.dispose).toHaveBeenCalledOnce();
    expect(late.update).not.toHaveBeenCalled();
    expect((wrapper.emitted('status') ?? []).some((entry) => entry[0] === 'live2d')).toBe(false);
  });
  it('shows a deliberate static fallback on failure and never mounts the old SVG actor', async () => {
    runtime.load.mockRejectedValue(new Error('CORE_UNAVAILABLE'));
    const wrapper = mount(CharacterStage, { props: { frame: idle, environment: 'rain' } });
    await flushPromises();
    expect(wrapper.attributes('data-renderer')).toBe('failed');
    expect(wrapper.get('img.live2d-poster').attributes('src')).toBe(
      '/assets/live2d/haru-poster.png',
    );
    expect(wrapper.text()).toContain('已显示静态角色画面');
    expect(wrapper.find('svg').exists()).toBe(false);
    expect(wrapper.emitted('status')?.at(-1)).toEqual(['failed']);
    wrapper.unmount();
  });
  it('keeps the new visible model when an old hidden load resolves late', async () => {
    const old = deferred<CharacterRenderer>();
    const current = renderer();
    runtime.load.mockReturnValueOnce(old.promise).mockResolvedValueOnce(current);
    const wrapper = mount(CharacterStage, { props: { frame: idle, environment: 'rain' } });
    await flushPromises();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();
    expect(wrapper.attributes('data-renderer')).toBe('suspended');
    expect(runtime.load.mock.calls[0]?.[1].aborted).toBe(true);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();
    expect(wrapper.attributes('data-renderer')).toBe('live2d');
    const stale = renderer();
    old.resolve(stale);
    await flushPromises();
    expect(runtime.load.mock.calls[0]?.[0]).not.toBe(runtime.load.mock.calls[1]?.[0]);
    expect(stale.dispose).toHaveBeenCalledOnce();
    expect(current.dispose).not.toHaveBeenCalled();
    expect(wrapper.attributes('data-renderer')).toBe('live2d');
    wrapper.unmount();
  });
  it('ignores obsolete context failure callbacks after a replacement has loaded', async () => {
    const first = renderer(),
      second = renderer();
    runtime.load.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const wrapper = mount(CharacterStage, { props: { frame: idle, environment: 'rain' } });
    await flushPromises();
    const oldFailure = runtime.load.mock.calls[0]?.[2]?.onFailure;
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();
    oldFailure?.(new Error('OLD_CONTEXT_LOST'));
    await flushPromises();
    expect(wrapper.attributes('data-renderer')).toBe('live2d');
    expect(second.dispose).not.toHaveBeenCalled();
    runtime.load.mock.calls[1]?.[2]?.onFailure?.(new Error('CONTEXT_LOST'));
    await flushPromises();
    expect(wrapper.attributes('data-renderer')).toBe('failed');
    expect(second.dispose).toHaveBeenCalledOnce();
    wrapper.unmount();
  });
});
