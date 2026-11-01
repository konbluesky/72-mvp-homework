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
    'ParamMouthForm',
    'ParamEyeLSmile',
    'ParamEyeRSmile',
    'ParamEyeLOpen',
    'ParamEyeROpen',
    'ParamMouthOpenY',
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
): Record<HaruParameter, number> {
  const relaxed = frame.emotion === 'relieved';
  const curious = frame.emotion === 'curious';
  const listening = frame.interaction === 'listening';
  const thinking = frame.interaction === 'thinking';
  const speaking = frame.interaction === 'speaking';
  const window = frame.action === 'lookWindow';
  const photo = frame.action === 'offerPhoto';
  const breathe = reducedMotion ? 0 : Math.sin(seconds * 1.6);
  const nod = reducedMotion ? 0 : Math.sin(seconds * 2.3);
  const voice = speaking ? Math.max(0, Math.min(1, frame.mouthOpen)) : 0;
  const blinkPhase = seconds % 5.7;
  const blink = !reducedMotion && blinkPhase < 0.19 ? Math.abs(blinkPhase / 0.095 - 1) : 1;

  // Interaction has a readable silhouette even when emotion stays the same.
  // Guarded means attentive and reserved here; it must not force a sad resting face.
  let angleX = 0;
  let angleY = breathe * 0.7;
  let angleZ = reducedMotion ? 0 : nod * 1.3;
  let bodyX = 0;
  let bodyY = 0;
  let bodyZ = 0;
  let gazeX = 0;
  let gazeY = 0;
  let browLeft = relaxed ? 0.22 : curious ? 0.8 : 0.08;
  let browRight = relaxed ? 0.22 : curious ? 0.48 : 0.08;
  let mouthForm = relaxed ? 1 : curious ? 0.7 : 0.45;
  let eyeOpen = relaxed ? 0.9 : 1;

  if (listening) {
    angleX = -8;
    angleY = -9 + breathe * 0.5;
    angleZ = -21 + nod * 1.8;
    bodyX = -3;
    bodyY = 9;
    bodyZ = -7;
    browLeft = Math.max(browLeft, 0.65);
    browRight = Math.max(browRight, 0.65);
    eyeOpen = 1;
    mouthForm = Math.max(mouthForm, 0.35);
  } else if (thinking) {
    angleX = 24;
    angleY = 15;
    angleZ = 22;
    bodyX = 6;
    bodyZ = 5;
    gazeX = 0.9;
    gazeY = 1;
    browLeft = 0.85;
    browRight = 0.08;
    eyeOpen = 0.94;
    mouthForm = 0.22;
  } else if (speaking) {
    // Mouth and emphasis are driven by the current sound, never a synthetic speech loop.
    const emphasis = reducedMotion ? 0 : voice;
    angleY = 1 + emphasis * 2.5;
    angleZ = -2 + emphasis * 4;
    bodyY = 2;
    bodyZ = -1 + emphasis * 2;
    browLeft += emphasis * 0.18;
    browRight += emphasis * 0.18;
    eyeOpen = 1;
  }

  // Story gestures retain ownership over the head and gaze channels.
  if (window) {
    angleX = -27;
    angleZ = -8;
    bodyX = -7;
    gazeX = -1;
    gazeY = 0;
  } else if (photo) {
    angleY = -4;
    angleZ = 5;
    bodyX = 3;
    bodyZ = -2;
    gazeY = -0.3;
  }

  return {
    ParamAngleX: angleX,
    ParamAngleY: angleY,
    ParamAngleZ: angleZ,
    ParamEyeBallX: gazeX,
    ParamEyeBallY: gazeY,
    ParamBodyAngleX: bodyX,
    ParamBodyAngleY: bodyY,
    ParamBodyAngleZ: bodyZ,
    ParamBreath: (breathe + 1) / 2,
    ParamBrowLY: browLeft,
    ParamBrowRY: browRight,
    ParamBrowLAngle: relaxed ? -0.28 : curious ? -0.16 : 0,
    ParamBrowRAngle: relaxed ? -0.28 : curious ? -0.08 : 0,
    ParamMouthForm: mouthForm,
    ParamEyeLSmile: relaxed && !thinking ? 0.48 : 0,
    ParamEyeRSmile: relaxed && !thinking ? 0.48 : 0,
    ParamEyeLOpen: blink * eyeOpen,
    ParamEyeROpen: blink * eyeOpen,
    ParamMouthOpenY: voice,
  };
}
