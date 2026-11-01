import type { CharacterFrame } from '../../../scene/character.js';
import type { CubismParts } from '../../../scene/live2d-types.js';

export const HARU_HAND_PARAMETERS = [
  'ParamArmRA',
  'ParamArmLA',
  'ParamArmRB',
  'ParamArmLB',
  'ParamHandChangeR',
  'ParamHandDhangeL',
  'ParamHandAngleR',
  'ParamHandAngleL',
] as const;

const armParts = ['Part01ArmRA001', 'Part01ArmLA001', 'Part01ArmRB001', 'Part01ArmLB001'] as const;
const ease = (value: number) => {
  const progress = Math.max(0, Math.min(1, value));
  return progress * progress * (3 - 2 * progress);
};

/** Calibrated on the pinned Haru: RB is the bent arm on the viewer's right, replacing LA. */
export function haruHands(
  frame: CharacterFrame,
  interactionSeconds: number,
  reducedMotion: boolean,
) {
  const active = frame.interaction === 'thinking' && frame.action === 'none';
  const progress = active ? (reducedMotion ? 1 : ease(interactionSeconds / 0.45)) : 0;
  return {
    weight: active ? (reducedMotion ? 1 : ease(interactionSeconds / 0.12)) : 0,
    parameters: {
      ParamArmRA: 0,
      ParamArmLA: 0,
      ParamArmRB: 2.5 * progress,
      ParamArmLB: 0,
      ParamHandChangeR: 0,
      ParamHandDhangeL: 0,
      ParamHandAngleR: 0,
      ParamHandAngleL: 0.05 * progress,
    } satisfies Record<(typeof HARU_HAND_PARAMETERS)[number], number>,
  };
}

export function bindHaruArmParts(core: CubismParts): (weight: number) => void {
  const count = core.getPartCount();
  if (!Number.isInteger(count) || count < 1 || count > 512) throw new Error('HARU_PART_COUNT');
  const indices = armParts.map((id) => {
    const index = core.getPartIndex(id);
    if (!Number.isInteger(index) || index < 0 || index >= count)
      throw new Error(`HARU_PART_MISSING:${id}`);
    return index;
  });
  return (value) => {
    const weight = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    const opacities = [1, 1 - weight, weight, 0];
    indices.forEach((index, position) => core.setPartOpacityByIndex(index, opacities[position]!));
  };
}
