import { abortable } from '../../playback/abortable.js';
import { Container } from 'pixi.js';
import type { Live2DModel, Cubism4InternalModel } from 'pixi-live2d-display-webgal/cubism4';
import type PixiStage from '../../engine/webgal/Core/controller/stage/pixi/PixiController';
import type { CharacterFrame } from '../../scene/character.js';

import { characterProfile, type CharacterId } from './profiles/index.js';
export type { CharacterId } from './profiles/index.js';
let coreLoad: Promise<void> | undefined;
function coreReady(): Promise<void> {
  return (coreLoad ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/assets/live2d/vendor/live2dcubismcore.min.js';
    script.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timer);
      coreLoad = undefined;
      script.remove();
      reject(new Error('CUBISM_CORE_LOAD_FAILED'));
    };
    const timer = setTimeout(() => script.onerror?.(new Event('error')), 10000);
    document.head.append(script);
  }));
}
export interface ParameterRange {
  id: string;
  index: number;
  min: number;
  max: number;
  defaultValue: number;
}
export function bindParameters(
  core: Cubism4InternalModel['coreModel'],
  ids: readonly string[],
): ParameterRange[] {
  const count = core.getParameterCount();
  if (!Number.isInteger(count) || count < 1 || count > 512)
    throw new Error('CHARACTER_PARAMETER_COUNT');
  return ids.map((id) => {
    const index = core.getParameterIndex(id);
    if (!Number.isInteger(index) || index < 0 || index >= count)
      throw new Error(`CHARACTER_PARAMETER_MISSING:${id}`);
    const min = core.getParameterMinimumValue(index),
      max = core.getParameterMaximumValue(index),
      defaultValue = core.getParameterDefaultValue(index);
    if (
      ![min, max, defaultValue].every(Number.isFinite) ||
      min >= max ||
      defaultValue < min ||
      defaultValue > max
    )
      throw new Error(`CHARACTER_PARAMETER_RANGE:${id}`);
    return { id, index, min, max, defaultValue };
  });
}
type Model = Live2DModel<Cubism4InternalModel>;
const emptyFrame: CharacterFrame = {
  interaction: 'idle',
  emotion: 'guarded',
  action: 'none',
  mouthOpen: 0,
  photoInHand: false,
};

/** One native stage animation updates one owned Cubism instance. No SDK auto ticker or sound. */
export class CharacterDriver {
  readonly root = new Container();
  private model?: Model;
  private epoch = 0;
  private disposed = false;
  private rawUntil = 0;
  private rawRevision = 0;
  private rawBaseline?: { model: Model; parameters: number[]; parts: number[] };
  private values = new Map<string, number>();
  private frame = emptyFrame;
  private gestureParameters: readonly string[] = [];
  private actionAt = performance.now();
  private ranges = new Map<string, ParameterRange>();
  private target = { x: 0, y: 0, height: 1, visible: false, lookDirection: 0 };
  private selected?: CharacterId;
  private readonly key = `interactive-character-${crypto.randomUUID()}`;
  constructor(
    private stage: PixiStage,
    private owner: () => boolean,
    private presentation: { hiddenParts?: Readonly<Record<string, readonly string[]>> } = {},
  ) {
    stage.figureContainer.addChild(this.root);
    stage.registerAnimation(
      {
        setStartState() {},
        setEndState() {},
        tickerFunc: () => {
          if (this.rawUntil && performance.now() > this.rawUntil) {
            this.stopPreview();
          }
          if (!this.disposed && this.owner())
            this.model?.update(Math.min(60, stage.currentApp?.ticker.deltaMS ?? 16));
        },
      },
      this.key,
    );
  }
  get parameters(): ParameterRange[] {
    return [...this.ranges.values()];
  }
  update(frame: CharacterFrame) {
    if (frame.action !== this.frame.action) this.actionAt = performance.now();
    if (frame.interaction !== 'idle' || frame.action !== 'none') this.stopPreview();
    this.frame = { ...frame };
  }
  layout(target: Omit<typeof this.target, 'lookDirection'> & { lookDirection?: number }) {
    this.target = { ...target, lookDirection: target.lookDirection ?? 0 };
    this.applyLayout();
  }
  private applyLayout() {
    const model = this.model;
    if (!model) return;
    const h = model.internalModel.originalHeight;
    model.scale.set(this.target.height / h);
    model.anchor.set(0.5, 1);
    model.position.set(this.target.x, this.target.y);
    model.visible = this.target.visible;
  }
  async select(id: CharacterId, signal: AbortSignal): Promise<void> {
    const mouth = this.ranges.get('ParamMouthOpenY');
    if (this.model && mouth)
      this.model.internalModel.coreModel.setParameterValueByIndex(mouth.index, mouth.min);
    const epoch = ++this.epoch;
    const valid = () => !this.disposed && this.owner() && this.epoch === epoch && !signal.aborted;
    const loadingSignal = AbortSignal.any([signal, AbortSignal.timeout(12000)]);
    // Core must remain lazy: bootstrap fixes interactive mode before importing its singletons.
    const { Live2D } = await abortable(import('../../engine/webgal/Core/WebGAL'), loadingSignal);
    if (!valid()) throw new DOMException('Character superseded', 'AbortError');
    await abortable(Live2D.initializeCubism4(coreReady()), loadingSignal);
    if (!valid()) throw new DOMException('Character superseded', 'AbortError');
    const sdk = await import('pixi-live2d-display-webgal/cubism4');
    sdk.config.sound = false;
    const pending = sdk.Live2DModel.from(characterProfile(id).model, {
      autoUpdate: false,
      autoInteract: false,
      idleMotionGroup: '__host_disabled__',
      motionPreload: sdk.MotionPreloadStrategy.NONE,
    }) as Promise<Model>;
    const guarded = pending.then((model) => {
      if (loadingSignal.aborted)
        model.destroy({ children: true, texture: false, baseTexture: false });
      return model;
    });
    const candidate = await abortable(guarded, loadingSignal);
    const destroy = () => candidate.destroy({ children: true, texture: false, baseTexture: false });
    if (!valid()) {
      destroy();
      throw new DOMException('Character superseded', 'AbortError');
    }
    try {
      const core = candidate.internalModel.coreModel;
      const ranges = bindParameters(core, characterProfile(id).parameters);
      candidate.internalModel.motionManager.stopAllMotions();
      candidate.internalModel.setBlinkParam({
        ...sdk.baseBlinkParam,
        blinkInterval: 86400000,
        blinkIntervalRandom: 0,
      });
      candidate.internalModel.on('afterMotionUpdate', () => {
        if (this.model === candidate && valid()) this.pose(core);
      });
      candidate.internalModel.on('beforeModelUpdate', () => {
        if (this.model === candidate && valid()) this.finalize(core, id);
      });
      const previous = this.model;
      this.ranges = new Map(ranges.map((range) => [range.id, range]));
      this.values.clear();
      this.model = candidate;
      this.selected = id;
      this.gestureParameters = [
        ...new Set(
          Object.values(characterProfile(id).gestures).flatMap((gesture) => Object.keys(gesture)),
        ),
      ];
      this.root.addChild(candidate);
      this.applyLayout();
      candidate.update(0);
      this.stage.currentApp?.render();
      if (previous) {
        this.root.removeChild(previous);
        previous.destroy({ children: true, texture: false, baseTexture: false });
      }
    } catch (error) {
      destroy();
      throw error;
    }
  }
  private set(core: Cubism4InternalModel['coreModel'], id: string, value: number, unit = false) {
    const r = this.ranges.get(id);
    if (!r) return;
    const center = r.min < 0 && r.max > 0 ? 0 : r.defaultValue;
    const x = unit
      ? r.min + (r.max - r.min) * value
      : center + (value >= 0 ? r.max - center : center - r.min) * value;
    // Cubism reloads saved motion parameters every update. Keep blend state outside that reset.
    const previous = this.values.get(id) ?? r.defaultValue;
    const weight = unit && id.startsWith('ParamEye') ? 0.68 : 0.24;
    const next = Math.max(r.min, Math.min(r.max, previous + (x - previous) * weight));
    this.values.set(id, next);
    core.setParameterValueByIndex(r.index, next);
  }
  previewOriginal(group: string) {
    const model = this.model,
      revision = ++this.rawRevision;
    if (!model || !this.selected || !characterProfile(this.selected).motionGroups.includes(group))
      return;
    void model.internalModel.motionManager
      .loadMotion(group, 0)
      .then(() => {
        if (this.disposed || this.model !== model || revision !== this.rawRevision) return;
        const core = model.internalModel.coreModel;
        this.rawBaseline = {
          model,
          parameters: Array.from({ length: core.getParameterCount() }, (_, index) =>
            core.getParameterValueByIndex(index),
          ),
          parts: Array.from({ length: core.getPartCount() }, (_, index) =>
            core.getPartOpacityByIndex(index),
          ),
        };
        this.rawUntil = performance.now() + 5200;
        void model.motion(group, 0, 3).catch(() => {
          if (this.model === model && revision === this.rawRevision) this.stopPreview();
        });
      })
      .catch(() => undefined);
  }
  stopPreview() {
    ++this.rawRevision;
    this.rawUntil = 0;
    this.model?.internalModel.motionManager.stopAllMotions();
    const baseline = this.rawBaseline;
    this.rawBaseline = undefined;
    if (baseline && baseline.model === this.model) {
      const core = this.model.internalModel.coreModel;
      baseline.parameters.forEach((value, index) => core.setParameterValueByIndex(index, value));
      baseline.parts.forEach((value, index) => core.setPartOpacityByIndex(index, value));
      core.saveParameters();
      for (const range of this.ranges.values())
        this.values.set(range.id, baseline.parameters[range.index]!);
    }
  }
  private pose(core: Cubism4InternalModel['coreModel']) {
    if (this.rawUntil) return;
    const f = this.frame,
      t = (performance.now() - this.actionAt) / 1000;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const wave = Math.max(0, Math.sin(Math.min(1, t / 1.45) * Math.PI));
    const window =
      f.action === 'lookWindow'
        ? Math.sin(Math.min(1, t / 2.8) * Math.PI) * this.target.lookDirection
        : 0;
    const thinking = f.interaction === 'thinking';
    this.set(core, 'ParamAngleX', thinking ? 0.45 : 0.7 * window);
    this.set(
      core,
      'ParamAngleY',
      f.action === 'offerPhoto' || f.action === 'focusProp'
        ? -0.26
        : thinking
          ? 0.35
          : f.interaction === 'listening'
            ? -0.22
            : 0,
    );
    this.set(
      core,
      'ParamAngleZ',
      thinking ? 0.45 : f.interaction === 'listening' ? -0.4 : 0.13 * window,
    );
    this.set(core, 'ParamBodyAngleX', thinking ? 0.13 : 0.22 * window);
    this.set(core, 'ParamBodyAngleZ', f.interaction === 'listening' ? -0.2 : 0);
    this.set(
      core,
      'ParamBreath',
      0.5 + (reduced ? 0 : Math.sin(performance.now() / 1400) * 0.14),
      true,
    );
    const profile = this.selected ? characterProfile(this.selected) : undefined;
    for (const id of this.gestureParameters)
      this.set(core, id, (profile?.gestures[f.action]?.[id] ?? 0) * wave);
    if (!reduced && f.interaction === 'idle')
      this.set(core, 'ParamAngleZ', Math.sin(performance.now() / 2400) * 0.04);
  }
  private finalize(core: Cubism4InternalModel['coreModel'], id: CharacterId) {
    const f = this.frame,
      t = (performance.now() - this.actionAt) / 1000;
    const window =
      f.action === 'lookWindow'
        ? Math.sin(Math.min(1, t / 2.8) * Math.PI) * this.target.lookDirection
        : 0;
    this.set(core, 'ParamEyeBallX', f.interaction === 'thinking' ? 0.5 : 0.9 * window);
    this.set(
      core,
      'ParamEyeBallY',
      f.action === 'offerPhoto' || f.action === 'focusProp'
        ? -0.3
        : f.interaction === 'thinking'
          ? 0.4
          : 0,
    );
    this.set(
      core,
      'ParamBrowLY',
      f.emotion === 'curious' ? 0.65 : f.emotion === 'relieved' ? 0.18 : 0,
    );
    this.set(
      core,
      'ParamBrowRY',
      f.emotion === 'curious' ? 0.35 : f.emotion === 'relieved' ? 0.18 : 0,
    );
    this.set(
      core,
      'ParamMouthForm',
      f.emotion === 'relieved' ? 0.65 : f.emotion === 'curious' ? 0.3 : 0,
    );
    const phase = (performance.now() / 1000) % 5.4,
      blink = phase < 0.16 ? Math.abs(phase / 0.08 - 1) : 1;
    for (const eye of ['ParamEyeLOpen', 'ParamEyeROpen']) {
      const r = this.ranges.get(eye)!;
      this.set(core, eye, (blink * (r.defaultValue - r.min)) / (r.max - r.min), true);
    }
    const r = this.ranges.get('ParamMouthOpenY')!;
    const mouth = f.interaction === 'speaking' ? Math.max(0, Math.min(1, f.mouthOpen)) : 0;
    core.setParameterValueByIndex(r.index, r.min + (r.max - r.min) * mouth);
    for (const part of this.presentation.hiddenParts?.[id] ?? []) {
      const index = core.getPartIndex(part);
      if (Number.isInteger(index) && index >= 0 && index < core.getPartCount())
        core.setPartOpacityByIndex(index, 0);
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    ++this.epoch;
    this.stage.removeAnimationWithoutSetEndState(this.key);
    this.model?.destroy({ children: true, texture: false, baseTexture: false });
    this.root.destroy({ children: true });
    this.model = undefined;
  }
}
