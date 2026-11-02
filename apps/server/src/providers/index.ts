import type { Config } from '../config/index.js';
import type { Fetch } from './http.js';
import type { ProviderSet } from './types.js';
import { DeepgramClient } from './deepgram/client.js';
import { DeepgramStt } from './deepgram/stt.js';
import { DeepgramTts } from './deepgram/tts.js';
import { ComfyImageProvider } from '../images/comfyui.js';
import { GptPlanner } from './openai/planner.js';
export * from './types.js';

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
    ...(config.APP_MODE === 'live' && config.IMAGE_PROVIDER === 'comfyui'
      ? { image: new ComfyImageProvider(config, fetcher) }
      : {}),
    planner: new GptPlanner(config, fetcher),
    tts: new DeepgramTts(client, {
      model: config.DEEPGRAM_MODEL,
      timeoutMs: config.TTS_TIMEOUT_MS,
      maxAudioBytes: config.MAX_AUDIO_BYTES,
    }),
  };
}
export function createProviders(
  config: Config,
  fetcher: Fetch = fetch,
  mockFactory?: () => Omit<ProviderSet, 'tts'>,
): ProviderSet {
  if (config.APP_MODE === 'mock' && !mockFactory)
    throw new Error('Mock content must be provided by the selected scenario.');
  const live = createLiveProviders(config, fetcher);
  // Real speech uses Deepgram. A keyless Mock session explicitly emits captions, never fake audio.
  const providers: ProviderSet =
    config.APP_MODE === 'mock'
      ? {
          ...mockFactory!(),
          tts: config.DEEPGRAM_API_KEY
            ? live.tts
            : {
                info: { provider: 'text-only', model: 'captions' },
                synthesize: async () => {
                  throw new Error('CAPTION_ONLY');
                },
              },
        }
      : live;
  if (config.STT_PROVIDER === 'disabled') return { ...providers, stt: undefined };
  return providers;
}
