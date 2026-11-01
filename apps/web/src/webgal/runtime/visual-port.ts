export interface LocalStageAsset {
  readonly id: string;
  readonly url: string;
}

export interface StageScene {
  readonly background: string;
  readonly effects: readonly 'rain'[];
  readonly zoom: number;
  readonly rainMask?: readonly [number, number, number, number];
  readonly rainStrength?: number;
}

export interface StageEvidence {
  stageEpoch: number;
  engineVersion: string;
  background: string;
  backgroundObjects: number;
  particles: number;
  commits: number;
  zoom: number;
  canvas: { width: number; height: number };
}

/** Local scene preview only. No audio, dialogue, business events or receipts. */
export interface StageVisualPort {
  present(scene: StageScene, signal?: AbortSignal): Promise<StageEvidence>;
  inspect(): StageEvidence;
  dispose(): void;
}
