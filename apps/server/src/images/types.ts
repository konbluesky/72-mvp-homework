import type { ImageShare, MediaVisualIntent, TurnIdentity } from '@mira/protocol';
export interface ImageIntentTags {
  focus: Record<MediaVisualIntent['focus'], string>;
  mood: Record<MediaVisualIntent['mood'], string>;
  framing: Record<MediaVisualIntent['framing'], string>;
}
export interface ImageRecipe {
  slotKey: string;
  originLabel: string;
  title: string;
  character: string;
  appearance: string;
  appearanceState?: string;
  location: string;
  environment: string;
  positive: string;
  negative: string;
  intentTags?: ImageIntentTags;
  width: number;
  height: number;
  introduction: string;
  readyLine: string;
  intent: MediaVisualIntent;
  seed: number;
}
export interface ImageWork {
  share: ImageShare;
  recipe: ImageRecipe;
  sourceTurn: TurnIdentity;
  slotEventId: string;
  slotConfirmed: boolean;
  attemptCount: number;
  work: 'awaiting-slot' | 'queued' | 'running' | 'submit_unknown' | 'ready' | 'failed' | 'ended';
  claim?: { id: string; turn: TurnIdentity; imageEventId?: string };
  retryRequestId?: string;
  abort: AbortController;
}
export interface GeneratedImage {
  bytes: Uint8Array;
  mimeType: 'image/png' | 'image/jpeg';
}
export interface ImageProvider {
  readonly simulated: boolean;
  generate(
    recipe: ImageRecipe,
    correlationId: string,
    signal: AbortSignal,
    update: (state: 'running' | 'submit_unknown') => void,
    attempt?: number,
  ): Promise<GeneratedImage>;
}
export class ImageGenerationError extends Error {
  constructor(readonly reason: 'generation_failed' | 'invalid_image' | 'deadline') {
    super(reason);
  }
}
