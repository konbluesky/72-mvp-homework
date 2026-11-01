import { engineMode } from '../../engine/webgal/host/runtimeMode';
import { EngineLifecycle } from './engine-lifecycle';
import type { LocalStageAsset } from './visual-port';

export function createInteractiveEngine(assets: readonly LocalStageAsset[]) {
  engineMode.configure('interactive');
  return new EngineLifecycle(async (signal) => {
    // The mode policy must exist before WebGAL/Live2D singletons are evaluated.
    const { mountEngine } = await import('./engine-adapter');
    signal.throwIfAborted();
    return mountEngine(signal, assets);
  });
}
