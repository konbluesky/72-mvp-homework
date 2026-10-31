import type { CharacterFrame, CharacterRenderer } from './character.js';
import {
  HARU_MANIFEST,
  bindHaruParameters,
  poseParameters,
  type HaruParameter,
} from './live2d-manifest.js';
import { loadRuntime, prepareModel, type PreparedModel } from './live2d-loader.js';
import type { Live2DApplication, Live2DModelPort, Live2DRuntime } from './live2d-types.js';

export interface Live2DOptions {
  onFailure?: (error: Error) => void;
}
const neutral = (): CharacterFrame => ({
  interaction: 'idle',
  emotion: 'guarded',
  action: 'none',
  mouthOpen: 0,
  photoInHand: false,
});

/** The component owns turn qualification; this adapter only renders its current qualified projection. */
export async function loadLive2D(
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
  options: Live2DOptions = {},
): Promise<CharacterRenderer> {
  signal.throwIfAborted();
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new Error('LIVE2D_LOAD_TIMEOUT')), 20_000);
  const combined = AbortSignal.any([signal, timeout.signal]);
  let prepared: PreparedModel | undefined;
  try {
    const runtime = await loadRuntime(combined);
    prepared = await prepareModel(runtime, combined);
    combined.throwIfAborted();
    const renderer = createLive2DRenderer(canvas, runtime, prepared, signal, options, combined);
    prepared = undefined; // The renderer now owns cleanup, including a late SDK settlement.
    return await renderer;
  } catch (error) {
    timeout.abort(error);
    prepared?.dispose();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Public for deterministic lifecycle tests; production calls this through loadLive2D. */
export function createLive2DRenderer(
  canvas: HTMLCanvasElement,
  runtime: Live2DRuntime,
  prepared: PreparedModel,
  ownerSignal: AbortSignal,
  options: Live2DOptions = {},
  loadingSignal = ownerSignal,
): Promise<CharacterRenderer> {
  return new Promise((resolve, reject) => {
    let app: Live2DApplication | undefined;
    let model: Live2DModelPort | undefined;
    let observer: ResizeObserver | undefined;
    let active = true,
      loading = true,
      settled = false,
      cleaned = false,
      assetsCleaned = false;
    let projection = neutral();
    let write: ReturnType<typeof bindHaruParameters> | undefined;
    let beforeUpdate: (() => void) | undefined;
    let frameTime = performance.now();
    const smoothed = new Map<HaruParameter, number>();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const ownedTextures = { children: true, texture: false, baseTexture: false };
    const disposeAssets = () => {
      if (!assetsCleaned) {
        assetsCleaned = true;
        prepared.dispose();
      }
    };
    const disposeModel = () => {
      if (cleaned) return;
      cleaned = true;
      if (model) {
        if (model.internalModel) model.destroy(ownedTextures);
        else runtime.Container.prototype.destroy.call(model, { children: true });
      }
      disposeAssets();
    };
    const tick = () => {
      if (!active || !model || document.hidden) return;
      try {
        model.update(Math.min(100, app?.ticker.deltaMS ?? 33.33));
      } catch (error) {
        fail(error);
      }
    };
    const syncVisibility = () => {
      if (!active || !app) return;
      if (document.hidden) app.stop();
      else {
        frameTime = performance.now();
        app.start();
      }
    };
    const dispose = () => {
      if (!active) return;
      active = false;
      ownerSignal.removeEventListener('abort', abort);
      loadingSignal.removeEventListener('abort', abort);
      canvas.removeEventListener('webglcontextlost', contextLost);
      document.removeEventListener('visibilitychange', syncVisibility);
      observer?.disconnect();
      if (model?.internalModel && beforeUpdate)
        model.internalModel.off('beforeModelUpdate', beforeUpdate);
      app?.stop();
      app?.ticker.remove(tick);
      if (model && !loading) app?.stage.removeChild(model);
      // The Vue component owns this canvas DOM node; model and texture ownership is separate.
      app?.destroy(false, { children: false, texture: false, baseTexture: false });
      app = undefined;
      if (loading) {
        model?.emit('destroy'); // Cancel wrapper-owned Blob/XHR work before revoking this mount's URLs.
        disposeAssets();
        if (model?.internalModel) disposeModel();
      } else disposeModel();
    };
    const fail = (error: unknown) => {
      const failure = error instanceof Error ? error : new Error('LIVE2D_RENDER_FAILED');
      const wasSettled = settled;
      dispose();
      if (!settled) {
        settled = true;
        reject(failure);
      } else if (wasSettled && !ownerSignal.aborted) options.onFailure?.(failure);
    };
    const abort = () => {
      dispose();
      if (!settled) {
        settled = true;
        reject(ownerSignal.reason ?? loadingSignal.reason ?? new Error('LIVE2D_CANCELLED'));
      }
    };
    const contextLost = (event: Event) => {
      event.preventDefault();
      if (active) fail(new Error('LIVE2D_CONTEXT_LOST'));
    };
    const modelSettled = (error?: unknown) => {
      loading = false;
      if (!active || ownerSignal.aborted || loadingSignal.aborted) {
        disposeModel();
        abort();
        return;
      }
      if (error !== undefined) {
        fail(error);
        return;
      }
      try {
        const internal = model?.internalModel;
        if (!model || !internal || !app) throw new Error('LIVE2D_MODEL_CONTRACT');
        if (
          !Number.isFinite(internal.originalWidth) ||
          !Number.isFinite(internal.originalHeight) ||
          internal.originalWidth <= 0 ||
          internal.originalHeight <= 0
        )
          throw new Error('LIVE2D_MODEL_BOUNDS');
        write = bindHaruParameters(internal.coreModel);
        internal.motionManager.stopAllMotions();
        app.stage.addChild(model);
        beforeUpdate = () => {
          if (!active || !write) return;
          const now = performance.now();
          const blend = reduced.matches
            ? 1
            : 1 - Math.exp(-Math.min(0.1, (now - frameTime) / 1000) * 7);
          frameTime = now;
          const values = poseParameters(projection, now / 1000, reduced.matches);
          for (const id of HARU_MANIFEST.parameters) {
            const target = values[id];
            const value =
              id === 'ParamMouthOpenY' || id === 'ParamEyeLOpen' || id === 'ParamEyeROpen'
                ? target
                : (smoothed.get(id) ?? target) + (target - (smoothed.get(id) ?? target)) * blend;
            smoothed.set(id, value);
            write(id, value);
          }
        };
        internal.on('beforeModelUpdate', beforeUpdate);
        const resize = () => {
          if (!active || !model || !app) return;
          const host = canvas.parentElement ?? canvas;
          const rect = host.getBoundingClientRect();
          const width = Math.max(1, rect.width),
            height = Math.max(1, rect.height);
          app.renderer.resize(width, height);
          const scale = Math.min(
            (width / internal.originalWidth) * 2.3,
            (height / internal.originalHeight) * 2.1,
          );
          model.scale.set(scale);
          model.anchor.set(0.5, 0);
          model.position.set(width / 2, 0);
        };
        resize();
        observer = new ResizeObserver(resize);
        observer.observe(canvas.parentElement ?? canvas);
        app.ticker.add(tick);
        syncVisibility();
        const renderer: CharacterRenderer = {
          update(frame) {
            if (!active || ownerSignal.aborted) return;
            projection = {
              ...frame,
              mouthOpen: Number.isFinite(frame.mouthOpen) ? frame.mouthOpen : 0,
            };
            if (projection.interaction !== 'speaking') write?.('ParamMouthOpenY', 0);
          },
          cancel() {
            if (!active) return;
            projection = {
              ...projection,
              interaction: 'idle',
              action: 'none',
              mouthOpen: 0,
              photoInHand: false,
            };
            internal.motionManager.stopAllMotions();
            smoothed.clear();
            write?.('ParamMouthOpenY', 0);
          },
          dispose,
        };
        settled = true;
        if (loadingSignal !== ownerSignal) loadingSignal.removeEventListener('abort', abort);
        resolve(renderer);
      } catch (error) {
        fail(error);
      }
    };
    ownerSignal.addEventListener('abort', abort, { once: true });
    if (loadingSignal !== ownerSignal)
      loadingSignal.addEventListener('abort', abort, { once: true });
    canvas.addEventListener('webglcontextlost', contextLost);
    document.addEventListener('visibilitychange', syncVisibility);
    try {
      ownerSignal.throwIfAborted();
      loadingSignal.throwIfAborted();
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      app = new runtime.Application({
        view: canvas,
        autoStart: false,
        sharedTicker: false,
        backgroundAlpha: 0,
        antialias: true,
        resolution: Math.min(devicePixelRatio || 1, 1.5),
        autoDensity: false,
      });
      app.ticker.maxFPS = 30;
      model = runtime.live2d.Live2DModel.fromSync(prepared.settings, {
        autoInteract: false,
        autoUpdate: false,
        idleMotionGroup: '__none__',
        motionPreload: 'NONE',
        onLoad: () => modelSettled(),
        onError: (error) => modelSettled(error),
      });
    } catch (error) {
      loading = false;
      fail(error);
    }
  });
}

export { HARU_MANIFEST } from './live2d-manifest.js';
// Preserve a single cancellation helper for tests of vendor callbacks that ignore abort.
export { abortableLoad } from './live2d-loader.js';
