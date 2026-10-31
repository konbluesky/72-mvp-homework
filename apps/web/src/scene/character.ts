import type { Action, Emotion, Interaction } from '@mira/protocol';
export interface CharacterFrame {
  interaction: Interaction;
  emotion: Emotion;
  action: Action;
  mouthOpen: number;
  photoInHand: boolean;
}
export interface CharacterRenderer {
  update(frame: CharacterFrame): void;
  cancel(): void;
  dispose(): void;
}
