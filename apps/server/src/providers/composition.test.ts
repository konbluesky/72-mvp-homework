import { describe, expect, it, vi } from 'vitest';
import {
  createProviders,
  createLiveProviders,
  type SpeechToTextProvider,
  type AudioData,
  type Transcription,
} from './index.js';
import { testConfig, testMedia, wav } from '../../test/helpers.js';
import { runConversation } from '../graphs/conversation.js';
import { SessionManager } from '../sessions/manager.js';
import { plannerResponse } from '../../../../tests/fixtures/provider-http.js';
import type { Fetch } from './http.js';
import type { ServerEvent } from '@mira/protocol';

describe('provider composition', () => {
  it('Mock never instantiates network adapters and disabled speech is reflected in both modes', async () => {
    const http = vi.fn<Fetch>();
    const providers = createProviders(testConfig(), http);
    expect(providers.stt?.info.provider).toBe('mock');
    await providers.stt?.transcribe(
      { bytes: wav(), mimeType: 'audio/wav' },
      new AbortController().signal,
    );
    expect(http).not.toHaveBeenCalled();
    expect(createProviders(testConfig({ STT_PROVIDER: 'disabled' }), http).stt).toBeUndefined();
  });
  it('swaps a single recognizer while the same Graph, GPT planner and TTS adapter keep running', async () => {
    class AlternativeStt implements SpeechToTextProvider {
      readonly info = { provider: 'alternative-test', model: 'recognizer-v1' };
      readonly seen: AudioData[] = [];
      async transcribe(audio: AudioData, signal: AbortSignal): Promise<Transcription> {
        signal.throwIfAborted();
        this.seen.push(audio);
        return { text: '我喜欢旅行。', simulated: false };
      }
    }
    const config = testConfig({
      APP_MODE: 'live',
      GPT_BASE_URL: 'https://gpt.example/v1',
      GPT_API_KEY: 'test-gpt',
      GPT_MODEL: 'test-model',
      DEEPGRAM_API_KEY: 'test-dg',
      DEEPGRAM_MODEL: 'flux-lijuan-zh',
    });
    const endpoints: string[] = [];
    const http = vi.fn<Fetch>().mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      endpoints.push(path);
      if (path === '/v1/chat/completions')
        return plannerResponse({
          suggestions: [],
          segments: [
            { text: '旅行让人想起很多事。', emotion: 'curious', action: 'lookWindow', events: [] },
          ],
        });
      if (path === '/v2/speak')
        return new Response(new Uint8Array([0xff, 0xfb, 0x90, 0, 1]), {
          headers: { 'Content-Type': 'audio/mpeg' },
        });
      throw new Error('Unexpected recognizer network call');
    });
    const live = createLiveProviders(config, http);
    const alternative = new AlternativeStt();
    const providers = { ...live, stt: alternative };
    expect(providers.planner).toBe(live.planner);
    expect(providers.tts).toBe(live.tts);
    const sessions = new SessionManager(config);
    const created = sessions.create();
    const session = sessions.authenticate(created.sessionId, `Bearer ${created.sessionToken}`);
    sessions.begin(session, { generation: 1, turnId: 'turn', receipts: [], frozenTurns: [] });
    const turn = sessions.startInput(session, 'turn', 1, 'input', 'digest');
    const media = testMedia(config);
    const events: Array<Pick<ServerEvent, 'type' | 'payload'>> = [];
    try {
      await runConversation(
        { config, providers, sessions, media, logger: { info: () => undefined } },
        session,
        turn,
        { kind: 'audio', bytes: wav(), mimeType: 'audio/wav' },
        async (event) => {
          events.push(event);
        },
      );
      expect(alternative.seen).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'input.transcribed',
        payload: { text: '我喜欢旅行。', simulated: false },
      });
      expect(endpoints).toEqual(['/v1/chat/completions', '/v2/speak']);
      expect(events.at(-1)?.type).toBe('reply.done');
    } finally {
      sessions.close();
      await media.close();
    }
  });
});
