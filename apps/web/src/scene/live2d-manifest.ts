import { expressiveCharacterPose } from '../webgal/characters/profiles/index.js';
import { HARU_HAND_PARAMETERS, haruHands } from '../webgal/characters/profiles/haru-hands.js';
import type { CharacterFrame } from './character.js';
import type { CubismParameters } from './live2d-types.js';

export const HARU_MANIFEST = {
  id: 'haru-technical-stand-in',
  model: '/assets/live2d/haru/Haru.model3.json',
  attribution: 'Haru © Live2D Inc. · 官方技术样例',
  capabilities: {
    audioMouth: true,
    expressions: true,
    lookWindow: true,
    specializedPhotoGesture: false,
  },
  libraries: [
    '/assets/live2d/vendor/pixi.min.js',
    '/assets/live2d/vendor/live2dcubismcore.min.js',
    '/assets/live2d/vendor/cubism4.min.js',
  ],
  parameters: [
    'ParamAngleX',
    'ParamAngleY',
    'ParamAngleZ',
    'ParamEyeBallX',
    'ParamEyeBallY',
    'ParamBodyAngleX',
    'ParamBodyAngleY',
    'ParamBodyAngleZ',
    'ParamBreath',
    'ParamBrowLY',
    'ParamBrowRY',
    'ParamBrowLAngle',
    'ParamBrowRAngle',
    'ParamBrowLForm',
    'ParamBrowRForm',
    'ParamMouthForm',
    'ParamEyeLSmile',
    'ParamEyeRSmile',
    'ParamEyeLOpen',
    'ParamEyeROpen',
    'ParamMouthOpenY',
    ...HARU_HAND_PARAMETERS,
  ],
} as const;
export type HaruParameter = (typeof HARU_MANIFEST.parameters)[number];

export function bindHaruParameters(
  core: CubismParameters,
): (id: HaruParameter, value: number) => void {
  const count = core.getParameterCount();
  if (!Number.isInteger(count) || count < 1 || count > 512)
    throw new Error('LIVE2D_PARAMETER_COUNT');
  const bounds = new Map<HaruParameter, { min: number; max: number }>();
  for (const id of HARU_MANIFEST.parameters) {
    // This wrapper invents indices for unknown IDs. Checking the real count prevents false capability claims.
    const index = core.getParameterIndex(id);
    if (!Number.isInteger(index) || index < 0 || index >= count)
      throw new Error(`LIVE2D_PARAMETER_MISSING:${id}`);
    const min = core.getParameterMinimumValue(index),
      max = core.getParameterMaximumValue(index);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max)
      throw new Error(`LIVE2D_PARAMETER_RANGE:${id}`);
    bounds.set(id, { min, max });
  }
  return (id, value) => {
    const range = bounds.get(id);
    if (!range || !Number.isFinite(value)) throw new Error('LIVE2D_PARAMETER_VALUE');
    core.setParameterValueById(id, Math.max(range.min, Math.min(range.max, value)));
  };
}

/** Final parameter ownership belongs here, after model physics and before Cubism draws. */
export function poseParameters(
  frame: CharacterFrame,
  seconds: number,
  reducedMotion: boolean,
  interactionSeconds = seconds,
): Record<HaruParameter, number> {
  const pose = expressiveCharacterPose(
    'haru',
    frame,
    seconds,
    reducedMotion,
    -1,
    1,
    interactionSeconds,
  );
  const phase = seconds % 5.7;
  const blink = !reducedMotion && phase < 0.19 ? Math.abs(phase / 0.095 - 1) : 1;
  return {
    ...haruHands(frame, interactionSeconds, reducedMotion).parameters,
    ParamAngleX: pose.angleX * 30,
    ParamAngleY: pose.angleY * 30,
    ParamAngleZ: pose.angleZ * 30,
    ParamEyeBallX: pose.gazeX,
    ParamEyeBallY: pose.gazeY,
    ParamBodyAngleX: pose.bodyX * 10,
    ParamBodyAngleY: pose.bodyY * 10,
    ParamBodyAngleZ: pose.bodyZ * 10,
    ParamBreath: pose.breath,
    ParamBrowLY: pose.browLeft,
    ParamBrowRY: pose.browRight,
    ParamBrowLAngle: pose.browAngleLeft,
    ParamBrowRAngle: pose.browAngleRight,
    ParamBrowLForm: pose.browFormLeft,
    ParamBrowRForm: pose.browFormRight,
    ParamMouthForm: pose.mouthForm,
    ParamEyeLSmile: pose.eyeSmileLeft,
    ParamEyeRSmile: pose.eyeSmileRight,
    ParamEyeLOpen: blink * Math.min(1, pose.eyeOpenLeft),
    ParamEyeROpen: blink * Math.min(1, pose.eyeOpenRight),
    ParamMouthOpenY: pose.mouthOpen,
  };
}
