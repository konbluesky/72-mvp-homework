import type {
  Action,
  Emotion,
  Facts,
  ReplyPlan,
  PresentationEvent,
  StoryState,
  StoryInteraction,
  StoryAction,
  SessionOpening,
  ReplySuggestion,
} from '@mira/protocol';

export interface StoryCheckpoint {
  storyId: string;
  version: string;
  artifactHash: string;
  revision: number;
  state: string;
  parentHash?: string;
}
export interface StoryFrame {
  recommendationPolicy?: { decisionPhases: readonly string[]; maxGuiding: number };
  story: StoryState;
  facts: Facts;
  known: Array<{ id: string; text: string }>;
  directorNote: string;
  presentation?: { character: string; environment: string };
}
export interface StoryBeat {
  caption: string;
  event: PresentationEvent extends infer E
    ? E extends PresentationEvent
      ? Omit<E, 'eventId'>
      : never
    : never;
  checkpoint: StoryCheckpoint;
  frame: StoryFrame;
  line?: { text: string; emotion: Emotion; action: Action };
}
export interface ScenarioDefinition {
  imageSharing?: {
    candidate(
      checkpoint: StoryCheckpoint,
      history: Array<{ role: 'user' | 'assistant'; text: string }>,
    ): Omit<import('../images/types.js').ImageRecipe, 'intent' | 'seed'> | undefined;
    accepts(checkpoint: StoryCheckpoint, recipe: import('../images/types.js').ImageRecipe): boolean;
    mockImage: string;
  };
  mockProviders?: () => Omit<import('../providers/types.js').ProviderSet, 'tts'>;
  initial(entry?: 'story' | 'conversation'): StoryCheckpoint;
  frame(checkpoint: StoryCheckpoint): StoryFrame;
  opening?(checkpoint: StoryCheckpoint): SessionOpening;
  suggestions?(checkpoint: StoryCheckpoint): ReplySuggestion[];
  propose(input: StoryInteraction | string, checkpoint: StoryCheckpoint): StoryBeat[];
  context(
    checkpoint: StoryCheckpoint,
    history: Array<{ role: 'user' | 'assistant'; text: string }>,
  ): {
    systemPrompt: string;
    scene: unknown;
    allowedActions: StoryAction[];
  };
  validate(plan: ReplyPlan): void;
  accept(current: StoryCheckpoint, next: StoryCheckpoint): StoryCheckpoint;
}
