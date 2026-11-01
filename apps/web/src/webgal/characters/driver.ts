import { abortable } from '../../playback/abortable.js';
import { Container } from 'pixi.js';
import type { Live2DModel, Cubism4InternalModel } from 'pixi-live2d-display-webgal/cubism4';
import type PixiStage from '../../engine/webgal/Core/controller/stage/pixi/PixiController';
import type { CharacterFrame } from '../../scene/character.js';

import { characterProfile, expressiveCharacterPose, type CharacterId } from './profiles/index.js';
import { bindHaruArmParts, haruHands } from './profiles/haru-hands.js';
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
  private interactionAt = this.actionAt;
  private ranges = new Map<string, ParameterRange>();
  private writeArmParts?: ReturnType<typeof bindHaruArmParts>;
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
    if (this.disposed || !this.owner()) return;
    if (frame.action !== this.frame.action) this.actionAt = performance.now();
    if (frame.interaction !== this.frame.interaction) this.interactionAt = performance.now();
    if (frame.interaction !== 'idle' || frame.action !== 'none') this.stopPreview();
    this.frame = { ...frame };
    if (frame.interaction !== 'thinking' || frame.action !== 'none') this.writeArmParts?.(0);
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
      const writeArmParts = id === 'haru' ? bindHaruArmParts(core) : undefined;
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
      this.writeArmParts = writeArmParts;
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
    const authoredGaze =
      this.frame.interaction === 'thinking' &&
      this.frame.action === 'none' &&
      (id === 'ParamEyeBallX' || id === 'ParamEyeBallY');
    const weight = authoredGaze
      ? 1
      : unit && id.startsWith('ParamEye')
        ? 0.68
        : id.startsWith('ParamBrow') || id.startsWith('ParamEyeBall') || id === 'ParamMouthForm'
          ? 0.42
          : 0.24;
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
    const profileId = this.selected;
    if (!profileId) return;
    const pose = expressiveCharacterPose(
      profileId,
      f,
      performance.now() / 1000,
      reduced,
      this.target.lookDirection,
      Math.abs(window),
      (performance.now() - this.interactionAt) / 1000,
    );
    this.set(core, 'ParamAngleX', pose.angleX);
    this.set(core, 'ParamAngleY', pose.angleY);
    this.set(core, 'ParamAngleZ', pose.angleZ);
    this.set(core, 'ParamBodyAngleX', pose.bodyX);
    this.set(core, 'ParamBodyAngleY', pose.bodyY);
    this.set(core, 'ParamBodyAngleZ', pose.bodyZ);
    this.set(core, 'ParamBreath', pose.breath, true);
    const profile = this.selected ? characterProfile(this.selected) : undefined;
    for (const id of this.gestureParameters)
      this.set(core, id, (profile?.gestures[f.action]?.[id] ?? 0) * wave);
  }
  private finalize(core: Cubism4InternalModel['coreModel'], id: CharacterId) {
    const f = this.frame,
      t = (performance.now() - this.actionAt) / 1000;
    const window =
      f.action === 'lookWindow'
        ? Math.sin(Math.min(1, t / 2.8) * Math.PI) * this.target.lookDirection
        : 0;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pose = expressiveCharacterPose(
      id,
      f,
      performance.now() / 1000,
      reduced,
      this.target.lookDirection,
      Math.abs(window),
      (performance.now() - this.interactionAt) / 1000,
    );
    // Feed the authored pose into physics first, then retain these channels for the draw.
    // Cubism's built-in breathing/focus must not soften the interaction silhouette.
    if (!this.rawUntil) {
      for (const parameter of [
        'ParamAngleX',
        'ParamAngleY',
        'ParamAngleZ',
        'ParamBodyAngleX',
        'ParamBodyAngleY',
        'ParamBodyAngleZ',
        'ParamBreath',
      ]) {
        const range = this.ranges.get(parameter);
        const value = this.values.get(parameter);
        if (range && value !== undefined) core.setParameterValueByIndex(range.index, value);
      }
    }
    this.set(core, 'ParamEyeBallX', pose.gazeX);
    this.set(core, 'ParamEyeBallY', pose.gazeY);
    this.set(core, 'ParamBrowLY', pose.browLeft);
    this.set(core, 'ParamBrowRY', pose.browRight);
    this.set(core, 'ParamBrowLAngle', pose.browAngleLeft);
    this.set(core, 'ParamBrowRAngle', pose.browAngleRight);
    this.set(core, 'ParamBrowLForm', pose.browFormLeft);
    this.set(core, 'ParamBrowRForm', pose.browFormRight);
    this.set(core, 'ParamMouthForm', pose.mouthForm);
    this.set(core, 'ParamEyeLSmile', pose.eyeSmileLeft, true);
    this.set(core, 'ParamEyeRSmile', pose.eyeSmileRight, true);
    const phase = (performance.now() / 1000) % 5.4;
    const blink = !reduced && phase < 0.16 ? Math.abs(phase / 0.08 - 1) : 1;
    for (const [eye, openness] of [
      ['ParamEyeLOpen', pose.eyeOpenLeft],
      ['ParamEyeROpen', pose.eyeOpenRight],
    ] as const) {
      const r = this.ranges.get(eye)!;
      this.set(
        core,
        eye,
        Math.min(1, (blink * openness * (r.defaultValue - r.min)) / (r.max - r.min)),
        true,
      );
    }
    const r = this.ranges.get('ParamMouthOpenY')!;
    core.setParameterValueByIndex(r.index, r.min + (r.max - r.min) * pose.mouthOpen);
    if (id === 'haru' && !this.rawUntil) {
      const hands = haruHands(f, (performance.now() - this.interactionAt) / 1000, reduced);
      for (const [parameter, value] of Object.entries(hands.parameters)) {
        const range = this.ranges.get(parameter)!;
        core.setParameterValueByIndex(range.index, Math.max(range.min, Math.min(range.max, value)));
      }
      this.writeArmParts?.(hands.weight);
    }
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
    this.writeArmParts = undefined;
  }
}
