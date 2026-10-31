import type { Config } from '../config/index.js';
import type { Fetch } from './http.js';
import type { ProviderSet } from './types.js';
import { DeepgramClient } from './deepgram/client.js';
import { DeepgramStt } from './deepgram/stt.js';
import { DeepgramTts } from './deepgram/tts.js';
import { GptPlanner } from './openai/planner.js';
import { createMockProviders } from './mock.js';
export * from './types.js';
export { createMockProviders } from './mock.js';

export function createLiveProviders(config: Config, fetcher: Fetch = fetch): ProviderSet {
  const client = new DeepgramClient(
    { apiKey: config.DEEPGRAM_API_KEY, baseUrl: config.DEEPGRAM_BASE_URL },
    fetcher,
  );
  return {
    ...(config.STT_PROVIDER === 'disabled'
      ? {}
      : {
          stt: new DeepgramStt(client, {
            model: config.DEEPGRAM_STT_MODEL,
            language: config.DEEPGRAM_STT_LANGUAGE,
            timeoutMs: config.STT_TIMEOUT_MS,
            maxInputBytes: config.MAX_UPLOAD_BYTES,
          }),
        }),
    planner: new GptPlanner(config, fetcher),
    tts: new DeepgramTts(client, {
      model: config.DEEPGRAM_MODEL,
      timeoutMs: config.TTS_TIMEOUT_MS,
      maxAudioBytes: config.MAX_AUDIO_BYTES,
    }),
  };
}
export function createProviders(config: Config, fetcher: Fetch = fetch): ProviderSet {
  const providers =
    config.APP_MODE === 'mock' ? createMockProviders() : createLiveProviders(config, fetcher);
  if (config.STT_PROVIDER === 'disabled') return { planner: providers.planner, tts: providers.tts };
  return providers;
}
