import type { AudioData, TextToSpeechProvider } from '../types.js';
import { DeepgramClient } from './client.js';
import { validateAudio } from '../../media/audio-format.js';

export interface DeepgramTtsOptions {
  model: string;
  timeoutMs: number;
  maxAudioBytes: number;
}
export class DeepgramTts implements TextToSpeechProvider {
  readonly info;
  constructor(
    private readonly client: DeepgramClient,
    private readonly options: DeepgramTtsOptions,
  ) {
    this.info = { provider: 'deepgram', model: options.model };
  }
  async synthesize(text: string, signal: AbortSignal): Promise<AudioData> {
    const response = await this.client.request(
      {
        path: '/v2/speak',
        query: { model: this.options.model, encoding: 'mp3' },
        body: JSON.stringify({ text }),
        mimeType: 'application/json',
        responseType: 'audio',
        timeoutMs: this.options.timeoutMs,
        maxBytes: this.options.maxAudioBytes,
      },
      signal,
    );
    const audio = {
      bytes: response.bytes,
      mimeType: response.mimeType,
      ...(response.requestId ? { requestId: response.requestId } : {}),
    };
    validateAudio(audio);
    signal.throwIfAborted();
    return audio;
  }
}
