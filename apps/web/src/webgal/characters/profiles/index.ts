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
  'ParamBodyAngleX',
  'ParamBodyAngleZ',
  'ParamBreath',
];
export interface CharacterProfile {
  label: string;
  model: string;
  attribution: string;
  parameters: readonly string[];
  motionGroups: readonly string[];
  gestures: Readonly<Record<string, Readonly<Record<string, number>>>>;
}
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
    gestures: { acknowledge: { ParamArmL1: 0.65, ParamArmL2: -0.45, ParamArmL3: 0.2 } },
  },
  haru: {
    label: 'Haru',
    model: '/assets/live2d/haru/Haru.model3.json',
    attribution: 'Haru © Live2D Inc. · 显式备用技术角色',
    parameters: face,
    motionGroups: [],
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
