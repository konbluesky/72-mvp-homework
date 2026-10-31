export interface ProviderInfo {
  readonly provider: string;
  readonly model: string;
}
export interface AudioData {
  bytes: Uint8Array;
  mimeType: string;
  requestId?: string;
}
export interface Transcription {
  text: string;
  simulated: boolean;
  requestId?: string;
  durationSeconds?: number;
}
export interface PlanInput {
  text: string;
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
  facts: string[];
  repair?: unknown;
}
export interface SpeechToTextProvider {
  readonly info: ProviderInfo;
  transcribe(input: AudioData, signal: AbortSignal): Promise<Transcription>;
}
export interface ReplyPlanner {
  readonly info: ProviderInfo;
  plan(input: PlanInput, signal: AbortSignal): Promise<unknown>;
}
export interface TextToSpeechProvider {
  readonly info: ProviderInfo;
  synthesize(text: string, signal: AbortSignal): Promise<AudioData>;
}
/** Composition by capability: replacing one adapter never changes Graph or playback. */
export interface ProviderSet {
  stt?: SpeechToTextProvider;
  planner: ReplyPlanner;
  tts: TextToSpeechProvider;
}
export interface ProviderFailure {
  provider?: string;
  status?: number;
  requestId?: string;
  retryable?: boolean;
}
export class ProviderError extends Error {
  readonly retryable: boolean;
  constructor(
    readonly code: 'PROVIDER_FAILED' | 'PROVIDER_TIMEOUT' | 'INVALID_AUDIO' | 'NO_SPEECH',
    message = '服务暂时不可用，请稍后重试。',
    readonly details: ProviderFailure = {},
  ) {
    super(message);
    this.name = 'ProviderError';
    this.retryable = details.retryable ?? true;
  }
}
