import type { Action, StoryState, PresentationEvent } from '@mira/protocol';
import type { InteractiveState } from '../../interaction/state.js';
import type { PresentationPort } from '../../playback/scheduler.js';
import type { CharacterDriver, CharacterId } from '../characters/driver.js';
import type { VisualEngineLease } from '../runtime/engine-adapter.js';
import type { LocalStageAsset } from '../runtime/visual-port.js';

export type { LocationDefinition } from './location.js';
import type { LocationDefinition } from './location.js';
export interface ScenePresentation extends PresentationPort {
  execute(
    event: Exclude<PresentationEvent, { type: 'photo' | 'environment' }>,
    signal: AbortSignal,
  ): Promise<void>;
  restore(story: StoryState, environment: string, signal: AbortSignal): Promise<void>;
  camera(action: Action): void;
  dismiss(): void;
  dispose(): void;
  previewScene?(zoom: number, environment: string, signal: AbortSignal): Promise<void>;
}
export interface SceneModule {
  id: string;
  version: string;
  title: string;
  subtitle: string;
  speaker: string;
  speakerDescription?: string;
  phaseLabels: Readonly<Record<string, string>>;
  characters: readonly CharacterId[];
  defaultCharacter: CharacterId;
  characterPresentation?: { hiddenParts?: Readonly<Record<string, readonly string[]>> };
  assets: readonly LocalStageAsset[];
  initialView: { story: StoryState; environment: string };
  location(id: string): LocationDefinition;
  createPresentation(
    lease: VisualEngineLease,
    actor: CharacterDriver,
    state: InteractiveState,
  ): ScenePresentation;
  environmentPreviews: readonly { label: string; value: string }[];
}
