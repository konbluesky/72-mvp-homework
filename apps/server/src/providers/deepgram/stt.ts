import { z } from 'zod';
import {
  ProviderError,
  type AudioData,
  type SpeechToTextProvider,
  type Transcription,
} from '../types.js';
import { DeepgramClient } from './client.js';
import { validateAudio } from '../../media/audio-format.js';

const ResponseSchema = z.object({
  metadata: z.object({
    request_id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
    duration: z.number().finite().nonnegative().max(31),
  }),
  results: z.object({
    channels: z
      .array(
        z.object({
          alternatives: z
            .array(z.object({ transcript: z.string().trim().max(1000) }))
            .min(1)
            .max(3),
        }),
      )
      .length(1),
  }),
});
export interface DeepgramSttOptions {
  model: string;
  language: string;
  timeoutMs: number;
  maxInputBytes: number;
}

export class DeepgramStt implements SpeechToTextProvider {
  readonly info;
  constructor(
    private readonly client: DeepgramClient,
    private readonly options: DeepgramSttOptions,
  ) {
    this.info = { provider: 'deepgram', model: options.model };
  }
  async transcribe(input: AudioData, signal: AbortSignal): Promise<Transcription> {
    signal.throwIfAborted();
    if (input.bytes.length > this.options.maxInputBytes || input.mimeType !== 'audio/wav')
      throw new ProviderError('INVALID_AUDIO');
    validateAudio(input);
    const response = await this.client.request(
      {
        path: '/v1/listen',
        query: { model: this.options.model, language: this.options.language, smart_format: 'true' },
        body: Buffer.from(input.bytes),
        mimeType: 'audio/wav',
        responseType: 'json',
        timeoutMs: this.options.timeoutMs,
        maxBytes: 131072,
      },
      signal,
    );
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes));
    } catch {
      throw new ProviderError('PROVIDER_FAILED', undefined, {
        provider: 'deepgram',
        status: 200,
        requestId: response.requestId,
      });
    }
    const parsed = ResponseSchema.safeParse(raw);
    if (!parsed.success)
      throw new ProviderError('PROVIDER_FAILED', undefined, {
        provider: 'deepgram',
        status: 200,
        requestId: response.requestId,
      });
    const text = parsed.data.results.channels[0]?.alternatives[0]?.transcript;
    if (!text)
      throw new ProviderError('NO_SPEECH', '刚才没有听清，请再说一次或使用文字。', {
        provider: 'deepgram',
        status: 200,
        requestId: parsed.data.metadata.request_id,
      });
    signal.throwIfAborted();
    return {
      text,
      simulated: false,
      requestId: parsed.data.metadata.request_id,
      durationSeconds: parsed.data.metadata.duration,
    };
  }
}
