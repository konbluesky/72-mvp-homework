import { describe, expect, it, vi } from 'vitest';
import { SessionCreatedSchema, ServerEventSchema, type ReplyPlan } from '@mira/protocol';
import { createApp } from '../app.js';
import { loadConfig } from '../config/index.js';
import { testMedia, wav } from '../../test/helpers.js';
import { createLiveProviders } from './index.js';
import { transcriptResponse, plannerResponse } from '../../../../tests/fixtures/provider-http.js';
import type { Fetch } from './http.js';

const plan: ReplyPlan = {
  suggestions: [],
  segments: [{ text: '你好，坐一会儿吧。', emotion: 'curious', action: 'none', events: [] }],
};
const mp3 = new Uint8Array([0xff, 0xfb, 0x90, 0, 1, 2, 3, 4]);
const liveConfig = (extra: Record<string, string> = {}) =>
  loadConfig({
    APP_MODE: 'live',
    NODE_ENV: 'test',
    GPT_BASE_URL: 'https://gpt.example/v1',
    GPT_API_KEY: 'test-gpt',
    GPT_MODEL: 'test-model',
    DEEPGRAM_API_KEY: 'test-deepgram',
    DEEPGRAM_MODEL: 'flux-lijuan-zh',
    ...extra,
  });
const input = (boundary: string) =>
  Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify({ generation: 1, inputId: 'audio-input', durationMs: 500 })}\r\n--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="recording.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
    ),
    wav(),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
describe('Live voice HTTP to actual capability adapters', () => {
  it('runs normalized audio through Deepgram STT, Graph GPT and Deepgram TTS without Mock events', async () => {
    const stages: string[] = [];
    const http = vi.fn<Fetch>().mockImplementation(async (url, request) => {
      const endpoint = new URL(String(url));
      if (endpoint.pathname === '/v1/listen') {
        stages.push('stt');
        expect(request?.headers).toMatchObject({
          Authorization: 'Token test-deepgram',
          'Content-Type': 'audio/wav',
        });
        expect(Buffer.isBuffer(request?.body)).toBe(true);
        return Response.json(transcriptResponse());
      }
      if (endpoint.pathname === '/v1/chat/completions') {
        stages.push('planner');
        return plannerResponse(plan);
      }
      if (endpoint.pathname === '/v2/speak') {
        stages.push('tts');
        return new Response(mp3, {
          headers: { 'Content-Type': 'audio/mpeg', 'dg-request-id': 'tts-request' },
        });
      }
      throw new Error('Unexpected provider endpoint');
    });
    const config = liveConfig();
    const app = await createApp({
      config,
      providers: createLiveProviders(config, http),
      media: testMedia(config),
      logger: false,
    });
    try {
      const created = SessionCreatedSchema.parse(
        (await app.inject({ method: 'POST', url: '/api/sessions' })).json(),
      );
      expect(created).toMatchObject({ mode: 'live', capabilities: { voiceInput: true } });
      const headers = { authorization: `Bearer ${created.sessionToken}` };
      const base = `/api/sessions/${created.sessionId}`;
      await app.inject({
        method: 'POST',
        url: `${base}/turns`,
        headers,
        payload: { generation: 1, turnId: 'audio-turn' },
      });
      const boundary = 'live-audio';
      const response = await app.inject({
        method: 'POST',
        url: `${base}/turns/audio-turn/input`,
        headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: input(boundary),
      });
      const frames = response.payload
        .split('\n\n')
        .filter((frame) => frame.startsWith('data: '))
        .map((frame) => ServerEventSchema.parse(JSON.parse(frame.slice(6))));
      expect(frames.map((event) => event.type)).toEqual([
        'ready',
        'input.transcribed',
        'audio.ready',
        'reply.done',
      ]);
      expect(frames[1]?.payload).toEqual({ text: '能看看照片吗？', simulated: false });
      expect(stages).toEqual(['stt', 'planner', 'tts']);
      const snapshot = (await app.inject({ url: base, headers })).json();
      expect(snapshot.capabilities.voiceInput).toBe(true);
      expect(snapshot.history).toEqual([{ role: 'user', text: '能看看照片吗？' }]);
    } finally {
      await app.close();
    }
  });
  it('advertises a deliberately disabled STT independently of Live mode', async () => {
    const config = liveConfig({ STT_PROVIDER: 'disabled' });
    const http = vi.fn<Fetch>();
    const app = await createApp({
      config,
      providers: createLiveProviders(config, http),
      media: testMedia(config),
      logger: false,
    });
    try {
      expect((await app.inject({ method: 'POST', url: '/api/sessions' })).json()).toMatchObject({
        mode: 'live',
        capabilities: { voiceInput: false },
      });
      expect(http).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
