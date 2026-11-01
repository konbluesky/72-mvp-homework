import { WebGAL } from '../../engine/webgal/Core/WebGAL';
import PixiStage from '../../engine/webgal/Core/controller/stage/pixi/PixiController';
import { stageStateManager } from '../../engine/webgal/Core/Modules/stage/stageStateManager';
import { engineMode } from '../../engine/webgal/host/runtimeMode';
import type { EngineLease } from './engine-lifecycle';
import { createNativeVisuals } from './native-visuals';
import type { LocalStageAsset, StageVisualPort } from './visual-port';

let stageEpoch = 0;
let current: EngineLease | undefined;

export interface VisualEngineLease extends EngineLease {
  visuals: StageVisualPort;
  readonly stage: PixiStage;
}

/** Scene modules execute authored cues through this owned native visual stage. */
export async function mountEngine(
  signal: AbortSignal,
  assets: readonly LocalStageAsset[],
): Promise<VisualEngineLease> {
  engineMode.requireInteractive();
  signal.throwIfAborted();
  if (current || WebGAL.gameplay.pixiStage) throw new Error('WEBGAL_STAGE_ALREADY_MOUNTED');
  const container = document.getElementById('pixiContianer');
  if (!container) throw new Error('WEBGAL_STAGE_CONTAINER_MISSING');

  const epoch = ++stageEpoch;
  const stage = new PixiStage();
  WebGAL.gameplay.pixiStage = stage;
  let disposed = false;
  const resize = () => {
    if (disposed || current !== lease) return;
    const { width, height } = container.getBoundingClientRect();
    if (width < 1 || height < 1) return;
    stage.currentApp?.renderer.resize(width, height);
    const fit = container.dataset.fit === 'cover' ? Math.max : Math.min;
    const scale = fit(width / stage.stageWidth, height / stage.stageHeight);
    stage.mainStageContainer.scale.set(scale);
    stage.mainStageContainer.position.set(width / 2, height / 2);
    stage.requestRender();
  };
  let observer: ResizeObserver | undefined;
  let visuals: StageVisualPort | undefined;
  const lease: VisualEngineLease = {
    stageEpoch: epoch,
    stage,
    get visuals() {
      if (!visuals) throw new Error('WEBGAL_VISUALS_NOT_INITIALIZED');
      return visuals;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      // Invalidate ownership synchronously, before releasing GPU/DOM resources.
      if (current !== lease) return;
      ++stageEpoch;
      current = undefined;
      observer?.disconnect();
      signal.removeEventListener('abort', lease.dispose);
      visuals?.dispose();
      stageStateManager.setCommitHandler(null);
      WebGAL.gameplay.resetGamePlay();
      WebGAL.gameplay.performController.removeAllPerform();
      WebGAL.gameplay.pixiStage = null;
      const app = stage.currentApp;
      stage.currentApp = null;
      stage.assets.detach();
      app?.destroy(true, { children: true });
      const globals = window as Window & { PIXIapp?: PixiStage; __PIXI_APP__?: unknown };
      if (globals.PIXIapp === stage) delete globals.PIXIapp;
      if (globals.__PIXI_APP__ === app) delete globals.__PIXI_APP__;
    },
  };
  current = lease;
  try {
    signal.addEventListener('abort', lease.dispose, { once: true });
    signal.throwIfAborted();
    visuals = createNativeVisuals(stage, assets, epoch, signal, () => current === lease, resize);
    observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    return lease;
  } catch (error) {
    lease.dispose();
    throw error;
  }
}
