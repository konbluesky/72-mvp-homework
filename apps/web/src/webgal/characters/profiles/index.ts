import type { Emotion, Interaction } from '@mira/protocol';
import type { CharacterFrame } from '../../../scene/character.js';

const face = [
  'ParamAngleX',
  'ParamAngleY',
  'ParamAngleZ',
  'ParamEyeBallX',
  'ParamEyeBallY',
  'ParamEyeLOpen',
  'ParamEyeROpen',
  'ParamMouthOpenY',
  'ParamMouthForm',
  'ParamBrowLY',
  'ParamBrowRY',
  'ParamBrowLAngle',
  'ParamBrowRAngle',
  'ParamBrowLForm',
  'ParamBrowRForm',
  'ParamBodyAngleX',
  'ParamBodyAngleZ',
  'ParamBreath',
];
export interface ExpressionProfile {
  browLeft: number;
  browRight: number;
  browAngleLeft: number;
  browAngleRight: number;
  browFormLeft: number;
  browFormRight: number;
  mouthForm: number;
  eyeOpenLeft: number;
  eyeOpenRight: number;
  eyeSmileLeft: number;
  eyeSmileRight: number;
}
export interface InteractionPose {
  angleX: number;
  angleY: number;
  angleZ: number;
  bodyX: number;
  bodyY: number;
  bodyZ: number;
  gazeX: number;
  gazeY: number;
}
export interface CharacterProfile {
  label: string;
  model: string;
  attribution: string;
  parameters: readonly string[];
  motionGroups: readonly string[];
  expressions: Readonly<Record<Emotion, ExpressionProfile>>;
  interactions: Readonly<Record<Interaction, InteractionPose>>;
  gestures: Readonly<Record<string, Readonly<Record<string, number>>>>;
}
// These are authored model mappings, shared by the Vue and WebGAL adapters.
// State changes deliberately use different silhouettes; emotion is not another interaction state.
const vividInteractions: Readonly<Record<Interaction, InteractionPose>> = {
  idle: { angleX: 0, angleY: 0, angleZ: 0, bodyX: 0, bodyY: 0, bodyZ: 0, gazeX: 0, gazeY: 0 },
  listening: {
    angleX: -0.36,
    angleY: -0.46,
    angleZ: -0.92,
    bodyX: -0.4,
    bodyY: 0.95,
    bodyZ: -0.8,
    gazeX: 0,
    gazeY: 0.04,
  },
  thinking: {
    angleX: 0.08,
    angleY: 0.06,
    angleZ: 0.1,
    bodyX: 0,
    bodyY: 0,
    bodyZ: 0.03,
    gazeX: 0.55,
    gazeY: 0.55,
  },
  speaking: {
    angleX: -0.06,
    angleY: 0.12,
    angleZ: -0.2,
    bodyX: 0,
    bodyY: 0.32,
    bodyZ: -0.18,
    gazeX: 0,
    gazeY: 0,
  },
};
const vividExpressions: Readonly<Record<Emotion, ExpressionProfile>> = {
  guarded: {
    browLeft: 0.08,
    browRight: 0.08,
    browAngleLeft: 0,
    browAngleRight: 0,
    browFormLeft: 0,
    browFormRight: 0,
    mouthForm: 0.28,
    eyeOpenLeft: 1,
    eyeOpenRight: 1,
    eyeSmileLeft: 0,
    eyeSmileRight: 0,
  },
  curious: {
    browLeft: 1,
    browRight: 0.56,
    browAngleLeft: -0.4,
    browAngleRight: -0.2,
    browFormLeft: 0.65,
    browFormRight: 0.4,
    mouthForm: 0.8,
    eyeOpenLeft: 1.15,
    eyeOpenRight: 1.15,
    eyeSmileLeft: 0,
    eyeSmileRight: 0,
  },
  relieved: {
    browLeft: 0.5,
    browRight: 0.5,
    browAngleLeft: -0.72,
    browAngleRight: -0.72,
    browFormLeft: 0.8,
    browFormRight: 0.8,
    mouthForm: 1,
    eyeOpenLeft: 0.48,
    eyeOpenRight: 0.48,
    eyeSmileLeft: 1,
    eyeSmileRight: 1,
  },
};
export const CHARACTERS = {
  miara: {
    label: 'Miara',
    model: '/assets/live2d/miara/miara_pro_t03.model3.json',
    attribution: 'Miara © Live2D Inc. · 官方技术样例',
    parameters: [
      ...face,
      'ParamArmL1',
      'ParamArmL2',
      'ParamArmL3',
      'ParamArmR1',
      'ParamArmR2',
      'ParamArmR3',
    ],
    motionGroups: ['Idle', 'Tap', 'Flic'],
    expressions: vividExpressions,
    interactions: vividInteractions,
    gestures: { acknowledge: { ParamArmL1: 0.65, ParamArmL2: -0.45, ParamArmL3: 0.2 } },
  },
  haru: {
    label: 'Haru',
    model: '/assets/live2d/haru/Haru.model3.json',
    attribution: 'Haru © Live2D Inc. · 官方技术样例',
    parameters: [...face, 'ParamBodyAngleY', 'ParamEyeLSmile', 'ParamEyeRSmile'],
    motionGroups: [],
    expressions: vividExpressions,
    interactions: vividInteractions,
    gestures: {},
  },
} satisfies Record<string, CharacterProfile>;
export type CharacterId = keyof typeof CHARACTERS;
export function characterProfile(id: CharacterId): CharacterProfile {
  return CHARACTERS[id];
}
export function isCharacterId(value: string): value is CharacterId {
  return Object.hasOwn(CHARACTERS, value);
}

export interface CharacterPose extends InteractionPose, ExpressionProfile {
  mouthOpen: number;
  breath: number;
}

// Short eye movements separated by holds read as considering something, rather than rolling eyes.
const thinkingGaze = [
  { at: 0, x: 0.55, y: 0.55 },
  { at: 1.1, x: 0.55, y: 0.55 },
  { at: 1.45, x: -0.35, y: 0.65 },
  { at: 2.5, x: -0.35, y: 0.65 },
  { at: 2.85, x: 0.1, y: 0.35 },
  { at: 3.5, x: 0.1, y: 0.35 },
  { at: 3.85, x: 0.55, y: 0.55 },
  { at: 4.6, x: 0.55, y: 0.55 },
] as const;

function thinkingEyes(seconds: number) {
  const phase = Math.max(0, seconds) % thinkingGaze[thinkingGaze.length - 1]!.at;
  for (let index = 1; index < thinkingGaze.length; index++) {
    const to = thinkingGaze[index]!;
    if (phase > to.at) continue;
    const from = thinkingGaze[index - 1]!;
    const progress = (phase - from.at) / (to.at - from.at);
    const eased = progress * progress * (3 - 2 * progress);
    return { x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased };
  }
  return thinkingGaze[0];
}

export function expressiveCharacterPose(
  id: CharacterId,
  frame: CharacterFrame,
  seconds: number,
  reducedMotion: boolean,
  lookDirection = -1,
  windowWeight = 1,
  interactionSeconds = seconds,
): CharacterPose {
  const profile = characterProfile(id);
  const voice = Number.isFinite(frame.mouthOpen) ? Math.max(0, Math.min(1, frame.mouthOpen)) : 0;
  const result: CharacterPose = {
    ...profile.interactions[frame.interaction],
    ...profile.expressions[frame.emotion],
    mouthOpen: frame.interaction === 'speaking' ? voice : 0,
    breath: 0.5 + (reducedMotion ? 0 : Math.sin(seconds * 1.6) * 0.2),
  };
  if (frame.interaction === 'idle') {
    if (frame.emotion === 'curious') {
      result.angleY = 0.18;
      result.angleZ = -0.28;
      result.bodyZ = -0.2;
    } else if (frame.emotion === 'relieved') {
      result.angleY = -0.12;
      result.angleZ = 0.24;
      result.bodyZ = 0.18;
    }
    if (!reducedMotion) {
      result.angleZ += Math.sin(seconds * 0.9) * 0.075;
      result.gazeX = Math.sin(seconds * 0.55) * 0.08;
    }
  }
  if (frame.interaction === 'listening') {
    result.browLeft = 0.95;
    result.browRight = 0.95;
    result.browAngleLeft = -0.55;
    result.browAngleRight = -0.55;
    result.browFormLeft = 0.8;
    result.browFormRight = 0.8;
    result.eyeOpenLeft = 1.15;
    result.eyeOpenRight = 1.15;
    result.eyeSmileLeft = 0;
    result.eyeSmileRight = 0;
    result.mouthForm = frame.emotion === 'relieved' ? 0.3 : 0.05;
    if (!reducedMotion) {
      // Two small acknowledgement nods, with a pause between pairs.
      const phase = seconds % 3.8;
      const nod = (start: number) =>
        phase >= start && phase < start + 0.5 ? Math.sin(((phase - start) / 0.5) * Math.PI) : 0;
      result.angleY -= (nod(0.4) + nod(1.05) * 0.7) * 0.24;
    }
  } else if (frame.interaction === 'thinking') {
    result.browLeft = 0.18;
    result.browRight = 0.18;
    result.browAngleLeft = 0;
    result.browAngleRight = 0;
    result.browFormLeft = 0;
    result.browFormRight = 0;
    result.eyeOpenLeft = 1;
    result.eyeOpenRight = 1;
    result.eyeSmileLeft = 0;
    result.eyeSmileRight = 0;
    result.mouthForm = 0.15;
    if (!reducedMotion) {
      const gaze = thinkingEyes(interactionSeconds);
      result.gazeX = gaze.x;
      result.gazeY = gaze.y;
    }
  } else if (frame.interaction === 'speaking') {
    const emphasis = reducedMotion ? 0 : result.mouthOpen;
    // Keep a distinct speaking face during silent syllable gaps; only audio opens the mouth.
    const smile = frame.emotion === 'relieved' ? 0.9 : 0.6;
    result.browLeft = 0.35 + emphasis * 0.6;
    result.browRight = 0.35 + emphasis * 0.4;
    result.browAngleLeft = -0.4 - emphasis * 0.2;
    result.browAngleRight = -0.4;
    result.browFormLeft = 0.65;
    result.browFormRight = 0.65;
    result.eyeOpenLeft = 0.68 + emphasis * 0.22;
    result.eyeOpenRight = 0.68 + emphasis * 0.22;
    result.eyeSmileLeft = smile;
    result.eyeSmileRight = smile;
    result.mouthForm = frame.emotion === 'relieved' ? 1 : 0.75 + emphasis * 0.25;
    result.angleY += emphasis * 0.36;
    result.angleZ += emphasis * 0.46;
    result.bodyX += emphasis * 0.18;
    result.bodyZ += emphasis * 0.38;
  }
  if (frame.action === 'lookWindow') {
    result.angleX = 0.9 * lookDirection * windowWeight;
    result.angleZ = 0.35 * lookDirection * windowWeight;
    result.bodyX = 0.62 * lookDirection * windowWeight;
    result.gazeX = lookDirection * windowWeight;
    result.gazeY = 0;
  } else if (frame.action === 'offerPhoto' || frame.action === 'focusProp') {
    result.angleY = -0.3;
    result.angleZ = 0.22;
    result.bodyX = 0.22;
    result.bodyZ = -0.18;
    result.gazeY = -0.4;
  }
  return result;
}
