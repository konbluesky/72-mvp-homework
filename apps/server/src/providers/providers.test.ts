import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { ReplyPlanSchema } from '@mira/protocol';
import { z } from 'zod';
import { loadConfig, type Config } from '../config/index.js';
import { MIRA_SYSTEM_PROMPT } from '../scenario/prompt.js';
import { DeepgramTts } from './deepgram/tts.js';
import { DeepgramClient } from './deepgram/client.js';
import { GptPlanner } from './openai/planner.js';
import { createLiveProviders } from './index.js';
import { validateAudio } from '../media/audio-format.js';
import { boundedBody, type Fetch } from './http.js';
import { createMockProviders, MOCK_LINES, mockPlan } from './mock.js';

const signal = () => new AbortController().signal;
const config = loadConfig({
  GPT_API_KEY: 'test-gpt',
  GPT_BASE_URL: 'https://gpt.example/v1',
  GPT_MODEL: 'user-chosen-model',
  DEEPGRAM_API_KEY: 'dg-token',
  DEEPGRAM_MODEL: 'flux-lijuan-zh',
});
const mp3 = new Uint8Array([0xff, 0xfb, 0x90, 0, 1, 2, 3, 4]);

function makeTts(config: Config, fetcher: Fetch) {
  return new DeepgramTts(
    new DeepgramClient(
      { apiKey: config.DEEPGRAM_API_KEY, baseUrl: config.DEEPGRAM_BASE_URL },
      fetcher,
    ),
    {
      model: config.DEEPGRAM_MODEL,
      timeoutMs: config.TTS_TIMEOUT_MS,
      maxAudioBytes: config.MAX_AUDIO_BYTES,
    },
  );
}

describe('provider contracts without paid network calls', () => {
  it('keeps planner HTTP failures diagnosable without exposing raw vendor errors', async () => {
    const http = vi
      .fn<Fetch>()
      .mockResolvedValue(
        Response.json(
          { error: { message: 'private test-gpt credential error', type: 'authentication_error' } },
          { status: 401, headers: { 'x-request-id': 'planner-request' } },
        ),
      );
    let error: unknown;
    try {
      await new GptPlanner(config, http).plan({ text: '你好', history: [], facts: [] }, signal());
    } catch (reason) {
      error = reason;
    }
    expect(error).toMatchObject({
      code: 'PROVIDER_FAILED',
      retryable: false,
      details: { provider: 'openai-compatible', status: 401, requestId: 'planner-request' },
    });
    expect(String(error)).not.toContain('private');
    expect(http).toHaveBeenCalledOnce();
  });
  it('Live composes independent STT, planner and TTS without eagerly making network requests', () => {
    const http = vi.fn<Fetch>();
    const live = createLiveProviders(config, http);
    expect(live.stt?.info).toEqual({ provider: 'deepgram', model: 'nova-3', language: 'zh-CN' });
    expect(live.planner.info.provider).toBe('openai-compatible');
    expect(live.tts.info.provider).toBe('deepgram');
    expect(http).not.toHaveBeenCalled();
  });
  it('uses the configured GPT and TTS providers for Live text input', async () => {
    const liveConfig = loadConfig({
      APP_MODE: 'live',
      GPT_BASE_URL: 'https://gpt.example/v1',
      GPT_API_KEY: 'test-gpt',
      GPT_MODEL: 'configured-live-model',
      DEEPGRAM_API_KEY: 'test-deepgram',
      DEEPGRAM_MODEL: 'flux-lijuan-zh',
    });
    const plan = {
      suggestions: [],
      segments: [
        { text: '来自已配置接口的回复。', emotion: 'curious', action: 'none', events: [] },
      ],
    };
    const http = vi.fn<Fetch>().mockImplementation(async (url) => {
      if (String(url).startsWith('https://gpt.example/v1/')) {
        return Response.json({
          id: 'configured-live-test',
          object: 'chat.completion',
          created: 1,
          model: 'configured-live-model',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: { role: 'assistant', content: JSON.stringify(plan) },
            },
          ],
        });
      }
      if (String(url).startsWith('https://api.deepgram.com/v2/speak')) {
        return new Response(mp3, { headers: { 'Content-Type': 'audio/mpeg' } });
      }
      throw new Error('Unexpected provider request');
    });
    const live = createLiveProviders(liveConfig, http);
    expect(await live.planner.plan({ text: '你好', facts: [], history: [] }, signal())).toEqual(
      plan,
    );
    expect(await live.tts.synthesize(plan.segments[0]!.text, signal())).toMatchObject({
      mimeType: 'audio/mpeg',
    });
    expect(http).toHaveBeenCalledTimes(2);
  });
  it('Deepgram uses Token auth, v2, model/encoding and bounded real audio', async () => {
    const http = vi
      .fn<Fetch>()
      .mockResolvedValue(new Response(mp3, { headers: { 'Content-Type': 'audio/mpeg' } }));
    const audio = await makeTts(config, http).synthesize('你好', signal());
    expect([...audio.bytes]).toEqual([...mp3]);
    expect(String(http.mock.calls[0]?.[0])).toBe(
      'https://api.deepgram.com/v2/speak?model=flux-lijuan-zh&encoding=mp3',
    );
    expect(http.mock.calls[0]?.[1]?.headers).toEqual({
      Authorization: 'Token dg-token',
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    });
    expect(JSON.parse(String(http.mock.calls[0]?.[1]?.body))).toEqual({ text: '你好' });
    http.mockResolvedValue(Response.json({ error: 'private vendor error' }));
    await expect(makeTts(config, http).synthesize('你好', signal())).rejects.toMatchObject({
      code: 'INVALID_AUDIO',
    });
    http.mockResolvedValue(new Response('{}', { headers: { 'Content-Type': 'audio/mpeg' } }));
    await expect(makeTts(config, http).synthesize('你好', signal())).rejects.toMatchObject({
      code: 'INVALID_AUDIO',
    });
  });
  it('stops reading a stream at the byte limit', async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(5));
        controller.enqueue(new Uint8Array(5));
      },
      cancel: cancelled,
    });
    await expect(boundedBody(new Response(body), 6, signal())).rejects.toThrow();
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
  it('propagates cancellation into fetch and discards late physical results', async () => {
    const controller = new AbortController();
    const http = vi.fn<Fetch>().mockImplementation(async (_url, init) => {
      controller.abort();
      expect(init?.signal?.aborted).toBe(true);
      return new Response(mp3, { headers: { 'Content-Type': 'audio/mpeg' } });
    });
    await expect(makeTts(config, http).synthesize('你好', controller.signal)).rejects.toThrow();
  });
  it('bounds an uncooperative provider and drops its eventual result', async () => {
    let finish!: (response: Response) => void;
    const http = vi.fn<Fetch>(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = makeTts({ ...config, TTS_TIMEOUT_MS: 10 }, http).synthesize('你好', signal());
    await expect(pending).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
    finish(new Response(mp3, { headers: { 'Content-Type': 'audio/mpeg' } }));
  });
  it('returns malformed structured output to Graph validation for its single repair', async () => {
    const http = vi.fn<Fetch>().mockResolvedValue(
      Response.json({
        id: 'chatcmpl-invalid',
        object: 'chat.completion',
        created: 1,
        model: 'user-chosen-model',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'definitely not JSON' },
            finish_reason: 'stop',
          },
        ],
      }),
    );
    const result = await new GptPlanner(
      { ...config, GPT_STRUCTURED_OUTPUT: 'json_mode' },
      http,
    ).plan({ text: '你好', facts: [], history: [] }, signal());
    expect(ReplyPlanSchema.safeParse(result).success).toBe(false);
    expect(http).toHaveBeenCalledTimes(1);
  });
  it.each(['json_schema', 'json_mode', 'function_calling'] as const)(
    'ChatOpenAI %s preserves user model and contract with no implicit model tuning',
    async (method) => {
      const plan = mockPlan('你好', []);
      const message =
        method === 'function_calling'
          ? {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'mira_reply', arguments: JSON.stringify(plan) },
                },
              ],
            }
          : { role: 'assistant', content: JSON.stringify(plan) };
      const http = vi.fn<Fetch>().mockResolvedValue(
        Response.json({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          created: 1,
          model: 'user-chosen-model',
          choices: [{ index: 0, message, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
      const result = await new GptPlanner({ ...config, GPT_STRUCTURED_OUTPUT: method }, http).plan(
        { text: '你好', facts: [], history: [] },
        signal(),
      );
      expect(result).toEqual(plan);
      const body: Record<string, unknown> = JSON.parse(String(http.mock.calls[0]?.[1]?.body));
      expect(body.model).toBe('user-chosen-model');
      expect(body.temperature).toBeUndefined();
      expect(body.reasoning).toBeUndefined();
      expect(String(http.mock.calls[0]?.[0])).toContain('/chat/completions');
      const messages = z
        .array(z.object({ role: z.string(), content: z.string() }))
        .parse(body.messages);
      const system = messages.find((entry) => entry.role === 'system')?.content;
      if (method === 'json_mode') {
        expect(body.response_format).toEqual({ type: 'json_object' });
        expect(system).toContain('不得添加额外字段');
        expect(system).toContain('不要输出 Markdown');
        expect(JSON.parse(system!.split('ReplyPlan JSON Schema:\n')[1]!)).toEqual(
          z.toJSONSchema(ReplyPlanSchema),
        );
      } else {
        expect(system).toBe(MIRA_SYSTEM_PROMPT);
      }
    },
  );
  it.each(['json_schema', 'function_calling'] as const)(
    'ChatOpenAI responses/%s uses the configured transport',
    async (method) => {
      const plan = mockPlan('你好', []);
      const output =
        method === 'function_calling'
          ? [
              {
                type: 'function_call',
                id: 'fc_1',
                call_id: 'call_1',
                name: 'mira_reply',
                arguments: JSON.stringify(plan),
                status: 'completed',
              },
            ]
          : [
              {
                type: 'message',
                id: 'msg_1',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: JSON.stringify(plan), annotations: [] }],
              },
            ];
      const http = vi.fn<Fetch>().mockResolvedValue(
        Response.json({
          id: 'resp_1',
          object: 'response',
          created_at: 1,
          status: 'completed',
          model: 'user-chosen-model',
          output,
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          parallel_tool_calls: false,
        }),
      );
      const result = await new GptPlanner(
        { ...config, GPT_API_STYLE: 'responses', GPT_STRUCTURED_OUTPUT: method },
        http,
      ).plan({ text: '你好', facts: [], history: [] }, signal());
      expect(result).toEqual(plan);
      expect(String(http.mock.calls[0]?.[0])).toContain('/responses');
    },
  );
});

describe('offline Mock audio and content', () => {
  it('all branches and every spoken line are valid, nonempty PCM speech assets', async () => {
    const provider = createMockProviders();
    for (const text of Object.values(MOCK_LINES)) {
      const audio = await provider.tts.synthesize(text, signal());
      expect(() => validateAudio(audio)).not.toThrow();
      expect(audio.bytes.length).toBeGreaterThan(10000);
      expect(new Set(audio.bytes.subarray(44)).size).toBeGreaterThan(100);
    }
    for (const input of ['你好', '你在等谁', '旅行', '我陪你', '能看看照片吗', '不要照片', '雨'])
      expect(
        ReplyPlanSchema.safeParse(
          await provider.planner.plan({ text: input, history: [], facts: [] }, signal()),
        ).success,
      ).toBe(true);
    const manifest: unknown = JSON.parse(
      await readFile(
        new URL('../../../../assets/mock-audio/manifest.json', import.meta.url),
        'utf8',
      ),
    );
    expect(manifest).toBeTruthy();
  });
  it('refusal does not reveal media and confirmed history changes the branch', () => {
    expect(mockPlan('我不想看照片', []).segments.flatMap((s) => s.events)).toEqual([]);
    expect(mockPlan('我也有一张照片', []).segments.flatMap((s) => s.events)).toEqual([]);
    expect(mockPlan('天气怎么样', []).segments[0]).toMatchObject({
      text: MOCK_LINES.hello,
      events: [],
    });
    expect(mockPlan('谢谢你', ['photo_revealed']).segments[0]?.text).toBe(MOCK_LINES.comfort);
    expect(mockPlan('然后呢', ['photo_revealed']).segments[0]?.text).toBe(MOCK_LINES.after);
  });
});
