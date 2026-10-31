import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Receipt, ServerEvent } from '@mira/protocol';
import { runConversation } from './conversation.js';
import { SessionManager } from '../sessions/manager.js';
import {
  testConfig,
  testMedia,
  testProviders,
  deferred,
  oneSegment,
  wav,
} from '../../test/helpers.js';
import type { ProviderSet } from '../providers/index.js';
import { GptPlanner } from '../providers/openai/planner.js';
import type { Fetch } from '../providers/http.js';

function setup(providers: ProviderSet, overrides: Record<string, string> = {}) {
  const config = testConfig(overrides);
  const sessions = new SessionManager(config);
  const created = sessions.create();
  const session = sessions.authenticate(created.sessionId, `Bearer ${created.sessionToken}`);
  sessions.begin(session, { generation: 1, turnId: 'turn', receipts: [], frozenTurns: [] });
  const turn = sessions.startInput(session, 'turn', 1, 'input', 'digest');
  const media = testMedia(config);
  const dependencies = { config, providers, sessions, media, logger: { info: () => undefined } };
  const events: Array<Pick<ServerEvent, 'type' | 'payload'>> = [];
  const publish = async (event: Pick<ServerEvent, 'type' | 'payload'>) => {
    events.push(event);
  };
  return {
    dependencies,
    session,
    turn,
    events,
    publish,
    cleanup: async () => {
      sessions.close();
      await media.close();
    },
  };
}
afterEach(() => vi.useRealTimers());

describe('real LangGraph orchestration', () => {
  it('generates context-aware suggestions in the same planner call without committing them as dialogue', async () => {
    const suggestions = [{ label: '问问那位朋友', draft: '你们上次见面是什么时候？' }];
    const plan = vi.fn<ProviderSet['planner']['plan']>(async () => ({
      ...oneSegment,
      suggestions,
    }));
    const ctx = setup(testProviders({ plan }));
    ctx.session.history.push({ role: 'assistant', text: '我在等一位老朋友。', mode: 'audio' });
    ctx.session.facts.photo_revealed = true;
    try {
      await runConversation(
        ctx.dependencies,
        ctx.session,
        ctx.turn,
        { kind: 'text', text: '你们认识多久了？' },
        ctx.publish,
      );
      expect(plan).toHaveBeenCalledOnce();
      expect(plan.mock.calls[0]?.[0]).toMatchObject({
        text: '你们认识多久了？',
        facts: ['photo_revealed'],
        history: [
          { role: 'assistant', text: '我在等一位老朋友。' },
          { role: 'user', text: '你们认识多久了？' },
        ],
      });
      expect(ctx.events.at(-1)).toEqual({
        type: 'reply.done',
        payload: { segmentCount: 1, suggestions },
      });
      expect(ctx.session.history).toHaveLength(2);
      expect(ctx.session.history.some((message) => message.text === suggestions[0]?.draft)).toBe(
        false,
      );
    } finally {
      await ctx.cleanup();
    }
  });
  it('uses one plan call and does not commit an unplayed response', async () => {
    const plan = vi.fn(async () => oneSegment);
    const ctx = setup(testProviders({ plan }));
    await runConversation(
      ctx.dependencies,
      ctx.session,
      ctx.turn,
      { kind: 'text', text: '你好' },
      ctx.publish,
    );
    expect(plan).toHaveBeenCalledOnce();
    expect(ctx.events.map((event) => event.type)).toEqual(['audio.ready', 'reply.done']);
    expect(ctx.session.history).toEqual([{ role: 'user', text: '你好' }]);
    expect(ctx.turn.status).toBe('completed');
    expect(ctx.turn.abort.signal.aborted).toBe(false);
    await ctx.cleanup();
  });
  it('repairs once inside the graph, then rejects a still-invalid model plan', async () => {
    const plan = vi.fn(async () => ({
      suggestions: [],
      segments: [{ text: 'hi', action: 'execute-js' }],
    }));
    const ctx = setup(testProviders({ plan }));
    await expect(
      runConversation(
        ctx.dependencies,
        ctx.session,
        ctx.turn,
        { kind: 'text', text: '你好' },
        ctx.publish,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_PLAN' });
    expect(plan).toHaveBeenCalledTimes(2);
    expect(ctx.events).toHaveLength(0);
    await ctx.cleanup();
  });
  it.each([
    { name: 'root', invalid: { ...oneSegment, url: 'https://unexpected.example/media' } },
    {
      name: 'segment',
      invalid: {
        suggestions: [],
        segments: [{ ...oneSegment.segments[0], url: 'https://unexpected.example/media' }],
      },
    },
  ])(
    'JSON mode rejects extra $name fields locally and repairs before synthesis',
    async ({ invalid }) => {
      const completion = (plan: unknown) =>
        Response.json({
          id: 'json-mode-test',
          object: 'chat.completion',
          created: 1,
          model: 'configured-model',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: { role: 'assistant', content: JSON.stringify(plan) },
            },
          ],
        });
      const http = vi
        .fn<Fetch>()
        .mockResolvedValueOnce(completion(invalid))
        .mockResolvedValueOnce(completion(oneSegment));
      const planner = new GptPlanner(
        testConfig({
          GPT_BASE_URL: 'https://gpt.example/v1',
          GPT_API_KEY: 'test-only',
          GPT_MODEL: 'configured-model',
          GPT_STRUCTURED_OUTPUT: 'json_mode',
        }),
        http,
      );
      const synthesize = vi.fn(testProviders().tts.synthesize);
      const ctx = setup(
        testProviders({
          plan: (input, signal) => planner.plan(input, signal),
          synthesize,
        }),
      );
      try {
        await runConversation(
          ctx.dependencies,
          ctx.session,
          ctx.turn,
          { kind: 'text', text: '你好' },
          ctx.publish,
        );
        expect(http).toHaveBeenCalledTimes(2);
        const repairRequest = JSON.parse(String(http.mock.calls[1]?.[1]?.body));
        expect(repairRequest.messages[0].content).toContain('ReplyPlan JSON Schema:');
        expect(JSON.parse(repairRequest.messages[1].content)).toHaveProperty('repair');
        expect(synthesize).toHaveBeenCalledOnce();
        expect(synthesize.mock.calls[0]?.[0]).toBe(oneSegment.segments[0]?.text);
        expect(ctx.events.map((event) => event.type)).toEqual(['audio.ready', 'reply.done']);
        expect(JSON.stringify(ctx.events)).not.toContain('unexpected.example');
      } finally {
        await ctx.cleanup();
      }
    },
  );
  it('a cancelled non-cooperative provider cannot publish its late result', async () => {
    const waiting = deferred<unknown>();
    const started = deferred<void>();
    const ctx = setup(
      testProviders({
        plan: async () => {
          started.resolve();
          return waiting.promise;
        },
      }),
    );
    const task = runConversation(
      ctx.dependencies,
      ctx.session,
      ctx.turn,
      { kind: 'text', text: '你好' },
      ctx.publish,
    );
    const rejected = expect(task).rejects.toThrow();
    await started.promise;
    ctx.dependencies.sessions.begin(ctx.session, {
      generation: 2,
      turnId: 'new',
      receipts: [],
      frozenTurns: [],
    });
    await rejected;
    waiting.resolve(oneSegment);
    await Promise.resolve();
    expect(ctx.events).toHaveLength(0);
    expect(ctx.session.current?.identity.turnId).toBe('new');
    await ctx.cleanup();
  });
  it('backpressures synthesis until the sentence two positions earlier is presented', async () => {
    const segments = Array.from({ length: 4 }, (_, i) => ({
      text: `第${i + 1}句话。`,
      emotion: 'curious',
      action: 'none',
      events: [],
    }));
    const synthesize = vi.fn(testProviders().tts.synthesize);
    const ctx = setup(
      testProviders({ plan: async () => ({ suggestions: [], segments }), synthesize }),
    );
    const twoReady = deferred<void>();
    const audio: Array<Extract<ServerEvent, { type: 'audio.ready' }>['payload']> = [];
    const task = runConversation(
      ctx.dependencies,
      ctx.session,
      ctx.turn,
      { kind: 'text', text: '聊聊旅行' },
      async (event) => {
        await ctx.publish(event);
        if (event.type === 'audio.ready') {
          audio.push(event.payload);
          if (audio.length === 2) twoReady.resolve();
        }
      },
    );
    await twoReady.promise;
    expect(synthesize).toHaveBeenCalledTimes(2);
    const receipt = (index: number): Receipt => ({
      ...ctx.turn.identity,
      receiptId: `r-${index}`,
      targetId: audio[index]!.segmentId,
      kind: 'segment',
      status: 'presented',
      mode: 'audio',
    });
    ctx.dependencies.sessions.receipts(ctx.session, [receipt(0), receipt(1)]);
    await task;
    expect(synthesize).toHaveBeenCalledTimes(4);
    expect(ctx.session.history.filter((entry) => entry.role === 'assistant')).toHaveLength(2);
    await ctx.cleanup();
  });
  it('waits for actual photo presentation and removes the environment event after photo failure', async () => {
    const plan = {
      suggestions: [],
      segments: [
        {
          text: '给你看照片。',
          emotion: 'relieved',
          action: 'offerPhoto',
          events: [{ type: 'photo', resourceId: 'travel_photo_01' }],
        },
        {
          text: '我们继续聊吧。',
          emotion: 'relieved',
          action: 'none',
          events: [{ type: 'environment', environment: 'rain-soft' }],
        },
      ],
    };
    const ctx = setup(testProviders({ plan: async () => plan }));
    await runConversation(
      ctx.dependencies,
      ctx.session,
      ctx.turn,
      { kind: 'text', text: '能看看照片吗？' },
      async (event) => {
        await ctx.publish(event);
        if (event.type === 'audio.ready' && event.payload.events[0]?.type === 'photo') {
          const receipt: Receipt = {
            ...ctx.turn.identity,
            receiptId: 'photo-failed',
            targetId: event.payload.events[0].eventId,
            kind: 'photo',
            status: 'failed',
          };
          ctx.dependencies.sessions.receipts(ctx.session, [receipt]);
        }
      },
    );
    const second = ctx.events.filter((event) => event.type === 'audio.ready')[1];
    expect(second?.payload).toMatchObject({ events: [] });
    expect(ctx.session.facts.rain_softened).toBe(false);
    await ctx.cleanup();
  });
  it('transcribes real uploaded bytes inside the graph and labels simulated recognition', async () => {
    const transcribe = vi.fn(
      async (_input: { bytes: Uint8Array; mimeType: string }, _signal: AbortSignal) => ({
        text: '示例识别',
        simulated: true,
      }),
    );
    const ctx = setup(testProviders({ transcribe }));
    await runConversation(
      ctx.dependencies,
      ctx.session,
      ctx.turn,
      { kind: 'audio', bytes: wav(), mimeType: 'audio/wav' },
      ctx.publish,
    );
    expect(transcribe.mock.calls[0]?.[0]).toMatchObject({ mimeType: 'audio/wav' });
    expect(ctx.events[0]).toEqual({
      type: 'input.transcribed',
      payload: { text: '示例识别', simulated: true },
    });
    await ctx.cleanup();
  });
});

it('clears the first budget after audio readiness and independently bounds the next synthesis', async () => {
  const firstReady = deferred<void>();
  const secondStarted = deferred<void>();
  let calls = 0;
  const ctx = setup(
    testProviders({
      plan: async () => ({
        suggestions: [],
        segments: [oneSegment.segments[0], oneSegment.segments[0]],
      }),
      synthesize: async () => {
        calls += 1;
        if (calls === 2) {
          secondStarted.resolve();
          return new Promise(() => undefined);
        }
        return { bytes: wav(), mimeType: 'audio/wav' };
      },
    }),
    { FIRST_AUDIO_TIMEOUT_MS: '500', NEXT_SEGMENT_TIMEOUT_MS: '30', TURN_MAX_LIFETIME_MS: '2000' },
  );
  const task = runConversation(
    ctx.dependencies,
    ctx.session,
    ctx.turn,
    { kind: 'text', text: '你好' },
    async (event) => {
      await ctx.publish(event);
      if (event.type === 'audio.ready') firstReady.resolve();
    },
  );
  const rejected = expect(task).rejects.toMatchObject({ code: 'NEXT_SEGMENT_TIMEOUT' });
  await firstReady.promise;
  await secondStarted.promise;
  expect(ctx.turn.firstAudioTimer).toBeUndefined();
  await rejected;
  expect(ctx.events).toHaveLength(1);
  await ctx.cleanup();
});
