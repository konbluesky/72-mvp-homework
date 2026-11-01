import { describe, expect, it, vi } from 'vitest';
import { EngineLifecycle, type EngineLease } from './engine-lifecycle';
import { createModePolicy } from '../../engine/webgal/host/runtimeMode';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('WebGAL host ownership', () => {
  it('disposes a late mount without replacing a newer stage', async () => {
    const old = deferred<EngineLease>();
    const next = { stageEpoch: 3, dispose: vi.fn() };
    const stale = { stageEpoch: 1, dispose: vi.fn() };
    const factory = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(next);
    const runtime = new EngineLifecycle(factory);
    const first = runtime.initialize();
    // Attach before cancellation to avoid an unhandled rejection in the test itself.
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    runtime.dispose();
    await expect(runtime.initialize()).resolves.toBe(next);
    old.resolve(stale);
    await rejected;
    expect(stale.dispose).toHaveBeenCalledOnce();
    expect(next.dispose).not.toHaveBeenCalled();
    runtime.dispose();
    runtime.dispose();
    expect(next.dispose).toHaveBeenCalledOnce();
  });

  it('shares initialization and permits a retry after a failed mount', async () => {
    const lease = { stageEpoch: 1, dispose: vi.fn() };
    const factory = vi.fn().mockRejectedValueOnce(new Error('GPU')).mockResolvedValueOnce(lease);
    const runtime = new EngineLifecycle(factory);
    const first = runtime.initialize();
    expect(runtime.initialize()).toBe(first);
    await expect(first).rejects.toThrow('GPU');
    await expect(runtime.initialize()).resolves.toBe(lease);
    expect(factory).toHaveBeenCalledTimes(2);
    runtime.dispose();
  });

  it('cancels before importing Core when unmounted in the same task', async () => {
    const factory = vi.fn();
    const runtime = new EngineLifecycle(factory);
    const pending = runtime.initialize();
    runtime.dispose();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(factory).not.toHaveBeenCalled();
  });

  it('rejects unconfigured/native execution and locks the page to one mode', () => {
    const policy = createModePolicy();
    expect(() => policy.requireStory('next')).toThrow('WEBGAL_STORY_DISABLED:next');
    expect(() => policy.requireInteractive()).toThrow('WEBGAL_INTERACTIVE_NOT_CONFIGURED');
    policy.configure('interactive');
    policy.configure('interactive');
    policy.requireInteractive();
    expect(() => policy.requireStory('vocal')).toThrow('WEBGAL_STORY_DISABLED:vocal');
    expect(() => policy.configure('story')).toThrow('WEBGAL_MODE_LOCKED');
  });
});
