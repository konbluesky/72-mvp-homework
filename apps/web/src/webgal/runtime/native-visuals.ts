import { abortable } from '../../playback/abortable.js';
import { BaseTexture, Texture, Sprite, Graphics } from 'pixi.js';
import type { Container } from 'pixi.js';
import type PixiStage from '../../engine/webgal/Core/controller/stage/pixi/PixiController';
import {
  stageStateManager,
  initState,
} from '../../engine/webgal/Core/Modules/stage/stageStateManager';
import { syncPixiStageState } from '../../engine/webgal/Core/controller/stage/pixi/syncPixiStageState';
import {
  call,
  type ILayerResult,
} from '../../engine/webgal/Core/util/pixiPerformManager/pixiPerformManager';
import '../../engine/webgal/Core/gameScripts/pixi/performs/rain';
import rainTextureUrl from '../../engine/webgal/assets/tex/rain.png';
import { __INFO } from '../../engine/webgal/config/info';
import type { LocalStageAsset, StageEvidence, StageScene, StageVisualPort } from './visual-port';

/** Execute local visual previews through native state sync, assets and effect/ticker APIs. */
export function createNativeVisuals(
  stage: PixiStage,
  assets: readonly LocalStageAsset[],
  stageEpoch: number,
  signal: AbortSignal,
  ownsStage: () => boolean,
  layout: () => void,
): StageVisualPort {
  let disposed = false;
  let revision = 0;
  let commits = 0;
  let current: StageScene | undefined;
  const rainLayers: ILayerResult[] = [];
  const rainMasks: Graphics[] = [];
  const frameWaiters = new Map<number, (reason: unknown) => void>();
  const localAssets = new Map(assets.map((asset) => [asset.id, asset]));
  if (assets.length > 16 || localAssets.size !== assets.length)
    throw new Error('STAGE_ASSET_MANIFEST');
  for (const asset of assets) {
    const url = new URL(asset.url, location.origin);
    if (
      !/^[a-z0-9_-]+$/.test(asset.id) ||
      url.origin !== location.origin ||
      !url.pathname.startsWith('/assets/')
    )
      throw new Error('STAGE_ASSET_NOT_LOCAL');
  }

  const valid = () => !disposed && !signal.aborted && ownsStage();
  const assertCurrent = (request: number) => {
    if (!valid() || revision !== request) throw new DOMException('Scene superseded', 'AbortError');
  };

  // The preview manifest is bounded and cached for this page, including across stage rebuilds.
  // Native AssetManager retains the textures while its renderer owns them; a late load never mounts.
  const requests = [
    ...assets.map((asset) => ({ url: asset.url, kind: 'texture' as const })),
    { url: rainTextureUrl, kind: 'texture' as const },
  ];
  for (const request of requests) stage.assets.retain(`preview-cache:${stageEpoch}`, request);
  const preparations = new Map<string, Promise<void>>();
  const prepare = (url: string, rainRequired: boolean): Promise<void> => {
    const key = `${url}:${rainRequired}`;
    const existing = preparations.get(key);
    if (existing) return existing;
    const selected = [
      { url, kind: 'texture' as const },
      ...(rainRequired ? [{ url: rainTextureUrl, kind: 'texture' as const }] : []),
    ];
    const operation = Promise.all(
      selected.map((request) => stage.assets.ensureReady<Texture>(request)),
    )
      .then((textures) => {
        if (!valid() || !rainRequired) return;
        const rain = textures.at(-1)!;
        BaseTexture.addToCache(rain.baseTexture, rainTextureUrl);
      })
      .catch((error) => {
        preparations.delete(key);
        throw error;
      });
    preparations.set(key, operation);
    return operation;
  };

  const stopRain = () => {
    for (const mask of rainMasks.splice(0)) mask.destroy();
    for (const layer of rainLayers.splice(0)) {
      stage.removeAnimationWithoutSetEndState(layer.tickerKey);
      const frames = new Set<Texture>();
      const collect = (container: Container) => {
        for (const child of container.children) {
          if (child instanceof Sprite) frames.add(child.texture);
          if ('children' in child) collect(child as Container);
        }
      };
      collect(layer.container);
      layer.container.destroy({ children: true });
      frames.forEach((texture) => texture.destroy(false));
    }
  };

  const waitForDraw = (request: number) =>
    new Promise<void>((resolve, reject) => {
      const id = requestAnimationFrame(() => {
        frameWaiters.delete(id);
        try {
          assertCurrent(request);
          stage.currentApp?.render();
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      frameWaiters.set(id, reject);
    });

  stageStateManager.replaceAllStageState(initState, {
    syncPixiStage: false,
    applyPixiEffects: false,
    notifyReact: false,
  });
  stageStateManager.setCommitHandler((state, options) => {
    if (!valid()) return;
    syncPixiStageState(state, options);
    layout();
    commits++;
  });

  const inspect = (): StageEvidence => ({
    stageEpoch,
    engineVersion: __INFO.version,
    background: current?.background ?? '',
    backgroundObjects: stage.backgroundObjects.length,
    particles: rainLayers.reduce(
      (sum, layer) => sum + (layer.container.children[0] as Container).children.length,
      0,
    ),
    commits,
    zoom: current?.zoom ?? 1,
    canvas: {
      width: stage.currentApp?.view.width ?? 0,
      height: stage.currentApp?.view.height ?? 0,
    },
  });

  return {
    async present(scene, ownerSignal) {
      ownerSignal?.throwIfAborted();
      const request = ++revision;
      assertCurrent(request);
      const asset = localAssets.get(scene.background);
      if (
        !asset ||
        !Number.isFinite(scene.zoom) ||
        scene.zoom < 1 ||
        scene.zoom > 1.2 ||
        scene.effects.some((effect) => effect !== 'rain') ||
        new Set(scene.effects).size !== scene.effects.length
      )
        throw new Error('STAGE_SCENE_NOT_REGISTERED');
      const preparation = prepare(asset.url, scene.effects.includes('rain'));
      await (ownerSignal ? abortable(preparation, ownerSignal) : preparation);
      ownerSignal?.throwIfAborted();
      assertCurrent(request);
      stopRain();
      stageStateManager.setStage('bgName', asset.url);
      stageStateManager.setStage('effects', [
        { target: 'bg-main', transform: { scale: { x: scene.zoom, y: scene.zoom } } },
      ]);
      stageStateManager.commit({ skipAnimation: true });
      if (scene.effects.includes('rain')) {
        if (!BaseTexture.from(rainTextureUrl).valid) throw new Error('STAGE_EFFECT_NOT_READY');
        const result = call('rain');
        for (const layer of [result.fg, result.bg])
          if (layer) {
            rainLayers.push(layer);
            layer.container.alpha = Math.max(0, Math.min(1, scene.rainStrength ?? 1));
            if (scene.rainMask) {
              stage.backgroundEffectsContainer.addChild(layer.container);
              const mask = new Graphics()
                .beginFill(0xffffff)
                .drawRect(...scene.rainMask)
                .endFill();
              stage.mainStageContainer.addChild(mask);
              layer.container.mask = mask;
              rainMasks.push(mask);
            }
          }
      }
      current = { ...scene, effects: [...scene.effects] };
      await waitForDraw(request);
      ownerSignal?.throwIfAborted();
      if (
        document.hidden ||
        (stage.currentApp &&
          'context' in stage.currentApp.renderer &&
          stage.currentApp.renderer.context.isLost)
      )
        throw new Error('STAGE_NOT_VISIBLE');
      return inspect();
    },
    inspect,
    dispose() {
      if (disposed) return;
      disposed = true;
      revision++;
      for (const [id, reject] of frameWaiters) {
        cancelAnimationFrame(id);
        reject(new DOMException('Stage disposed', 'AbortError'));
      }
      frameWaiters.clear();
      stopRain();
    },
  };
}
