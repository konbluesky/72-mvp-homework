import { plannerOutput } from '../../../../tests/fixtures/provider-http.js';
import { cafeScenario } from '../scenario/cafe/index.js';
import { advance, firstEncounter, followTo } from '../scenario/cafe/story.test.helpers.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Receipt, ServerEvent, ReplyPlan } from '@mira/protocol';
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

function setup(providers: ProviderSet, overrides: Record<string, string> = {}, arrival = false) {
  const config = testConfig(overrides);
  const sessions = new SessionManager(config, { scenario: cafeScenario });
  const created = sessions.create();
  const session = sessions.authenticate(created.sessionId, `Bearer ${created.sessionToken}`);
  if (!arrival) {
    session.narrative = advance(firstEncounter(), 'talk-sit');
    session.story = cafeScenario.frame(session.narrative).story;
  }
  sessions.begin(session, { generation: 1, turnId: 'turn', receipts: [], frozenTurns: [] });
  const turn = sessions.startInput(session, 'turn', 1, 'input', 'digest');
  const media = testMedia(config);
  const dependencies = {
    scenario: cafeScenario,
    config,
    providers,
    sessions,
    media,
    logger: { info: () => undefined },
  };
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
async function acknowledge(
  ctx: ReturnType<typeof setup>,
  event: Pick<ServerEvent, 'type' | 'payload'>,
) {
  await ctx.publish(event);
  const targets =
    event.type === 'presentation.ready'
      ? (event.payload as import('@mira/protocol').PresentationReadyPayload).events.map((item) => ({
          targetId: item.eventId,
          kind: item.type,
        }))
      : event.type === 'audio.ready' || event.type === 'text.ready'
        ? [
            {
              targetId: (event.payload as import('@mira/protocol').AudioReadyPayload).segmentId,
              kind: 'segment' as const,
              mode: event.type === 'text.ready' ? ('text' as const) : ('audio' as const),
            },
          ]
        : [];
  ctx.dependencies.sessions.receipts(
    ctx.session,
    targets.map((target, index) => ({
      ...ctx.turn.identity,
      ...target,
      receiptId: `presented-${ctx.events.length}-${index}`,
      status: 'presented' as const,
    })),
  );
}
afterEach(() => vi.useRealTimers());

describe('voice-off output and explicit image preparation', () => {
  it('advances a scene with visible captions and no TTS when voice is disabled', async () => {
    const synthesize = vi.fn(async () => ({ bytes: wav(), mimeType: 'audio/wav' }));
    const plan = vi.fn(async () => ({
      ...oneSegment,
      actionId: null,
      actionRequest: null,
      mediaDecision: null,
    }));
    const ctx = setup(testProviders({ synthesize, plan }));
    try {
      await runConversation(
        ctx.dependencies,
        ctx.session,
        ctx.turn,
        {
          kind: 'interaction',
          interaction: {
            kind: 'action',
            actionId: 'talk-next-scene',
            revision: ctx.session.narrative.revision,
          },
          voicePlayback: false,
        },
        (event) => acknowledge(ctx, event),
      );
      expect(ctx.session.story.beat).toBe('first-coffee');
      expect(synthesize).not.toHaveBeenCalled();
      expect(ctx.events.some((event) => event.type === 'audio.ready')).toBe(false);
      expect(ctx.events.find((event) => event.type === 'text.ready')).toMatchObject({
        payload: { autoAdvance: true },
      });
    } finally {
      await ctx.cleanup();
    }
  });
  it('does not synthesize speech for a voice-off request', async () => {
    const synthesize = vi.fn(async () => ({ bytes: wav(), mimeType: 'audio/wav' }));
    const ctx = setup(testProviders({ synthesize }));
    try {
      await runConversation(
        ctx.dependencies,
        ctx.session,
        ctx.turn,
        { kind: 'text', text: '你好', voicePlayback: false },
        ctx.publish,
      );
      expect(synthesize).not.toHaveBeenCalled();
      expect(ctx.events.find((event) => event.type === 'text.ready')).toMatchObject({
        payload: { captionOnly: true, autoAdvance: true },
      });
      expect(ctx.events.some((event) => event.type === 'audio.ready')).toBe(false);
      expect(ctx.session.history).toEqual([]);
    } finally {
      await ctx.cleanup();
    }
  });
  it('can explicitly prepare an image after seating without a chat gate or planner call', async () => {
    const plan = vi.fn(async () => oneSegment);
    const synthesize = vi.fn(async () => ({ bytes: wav(), mimeType: 'audio/wav' }));
    const ctx = setup(testProviders({ plan, synthesize }));
    const start = vi.fn();
    ctx.dependencies.providers.image = {
      simulated: false,
      generate: vi.fn(async () => {
        throw new Error('not called before the slot receipt');
      }),
    };
    ctx.dependencies.sessions.imageLifecycle = {
      start,
      removed: vi.fn(),
      discard: vi.fn(),
      assetAvailable: () => false,
    };
    try {
      expect(ctx.session.confirmedConversation).toBeUndefined();
      await runConversation(
        ctx.dependencies,
        ctx.session,
        ctx.turn,
        {
          kind: 'interaction',
          interaction: { kind: 'image', revision: ctx.session.narrative.revision },
          voicePlayback: false,
        },
        ctx.publish,
      );
      expect(plan).not.toHaveBeenCalled();
      expect(synthesize).not.toHaveBeenCalled();
      expect(start).not.toHaveBeenCalled();
      const work = [...ctx.session.imageShares.values()][0]!;
      expect(work.slotConfirmed).toBe(false);
      expect(ctx.events.some((event) => event.type === 'image.pending')).toBe(true);
      ctx.dependencies.sessions.receipts(ctx.session, [
        {
          ...ctx.turn.identity,
          receiptId: 'visible-slot',
          targetId: work.slotEventId,
          kind: 'image-slot',
          status: 'presented',
        },
      ]);
      expect(start).toHaveBeenCalledOnce();
      expect(ctx.session.history).toEqual([]);
    } finally {
      await ctx.cleanup();
    }
  });
  it('rejects an old image request before reserving or calling providers', async () => {
    const plan = vi.fn(async () => oneSegment);
    const ctx = setup(testProviders({ plan }));
    try {
      await expect(
        runConversation(
          ctx.dependencies,
          ctx.session,
          ctx.turn,
          {
            kind: 'interaction',
            interaction: { kind: 'image', revision: ctx.session.narrative.revision - 1 },
          },
          ctx.publish,
        ),
      ).rejects.toMatchObject({ code: 'STALE_TURN' });
      expect(ctx.session.imageShares.size).toBe(0);
      expect(plan).not.toHaveBeenCalled();
    } finally {
      await ctx.cleanup();
    }
  });
});

describe('real LangGraph orchestration', () => {
  it('does not call a planner or voice provider before the player has met the character', async () => {
    const plan = vi.fn(async () => oneSegment);
    const synthesize = vi.fn(async () => ({ bytes: wav(), mimeType: 'audio/wav' }));
    const ctx = setup(testProviders({ plan, synthesize }), {}, true);
    try {
      await expect(
        runConversation(
          ctx.dependencies,
          ctx.session,
          ctx.turn,
          { kind: 'text', text: '你好' },
          ctx.publish,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      expect(plan).not.toHaveBeenCalled();
      expect(synthesize).not.toHaveBeenCalled();
      expect(ctx.session.history).toEqual([]);
      expect(ctx.events).toEqual([]);
    } finally {
      await ctx.cleanup();
    }
  });
  it('generates context-aware suggestions in the same planner call without committing them as dialogue', async () => {
    const suggestions = [{ label: '问问那位朋友', draft: '你们上次见面是什么时候？' }];
    const plan = vi.fn<ProviderSet['planner']['plan']>(async () => ({
      ...(oneSegment as ReplyPlan),
      suggestions,
    }));
    const ctx = setup(testProviders({ plan }));
    ctx.session.history.push({ role: 'assistant', text: '我在等一位老朋友。', mode: 'audio' });
    ctx.session.facts.rain_softened = true;
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
        facts: ['rain_softened'],
        history: [{ role: 'assistant', text: '我在等一位老朋友。' }],
      });
      expect(ctx.events.at(-1)).toEqual({
        type: 'reply.done',
        payload: { segmentCount: 1, suggestions },
      });
      expect(ctx.session.history).toHaveLength(1);
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
    expect(ctx.session.history).toEqual([]);
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
    {
      name: 'root',
      invalid: { ...(oneSegment as ReplyPlan), url: 'https://unexpected.example/media' },
    },
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
        .mockResolvedValueOnce(completion(plannerOutput(oneSegment as ReplyPlan)));
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
  it('generates a contextual reply only after structured movement is actually presented', async () => {
    const planner = vi.fn<ProviderSet['planner']['plan']>(async () =>
      plannerOutput(oneSegment as ReplyPlan),
    );
    const tts = vi.fn(async () => ({ bytes: wav(), mimeType: 'audio/wav' }));
    const ctx = setup(testProviders({ plan: planner, synthesize: tts }));
    const shown = deferred<Pick<ServerEvent, 'type' | 'payload'>>();
    const task = runConversation(
      ctx.dependencies,
      ctx.session,
      ctx.turn,
      { kind: 'interaction', interaction: { kind: 'move', location: 'counter' } },
      async (event) => {
        if (event.type === 'presentation.ready') {
          await ctx.publish(event);
          shown.resolve(event);
        } else await ctx.publish(event);
      },
    );
    const event = await shown.promise;
    expect(planner).not.toHaveBeenCalled();
    expect(tts).not.toHaveBeenCalled();
    expect(ctx.session.story.location).toBe('window-seat');
    const payload = event.payload as import('@mira/protocol').PresentationReadyPayload;
    ctx.dependencies.sessions.receipts(
      ctx.session,
      payload.events.map((item, index) => ({
        ...ctx.turn.identity,
        targetId: item.eventId,
        receiptId: `move-${index}`,
        kind: item.type,
        status: 'presented' as const,
      })),
    );
    await task;
    expect(planner).toHaveBeenCalledOnce();
    expect(planner.mock.calls[0]?.[0]).toMatchObject({
      scene: { location: 'counter', beat: 'first-counter' },
    });
    expect(tts).toHaveBeenCalledOnce();
    expect(ctx.session.story.location).toBe('counter');
    expect(ctx.events.at(-1)).toMatchObject({ type: 'reply.done', payload: { segmentCount: 1 } });
    await ctx.cleanup();
  });
  it('rejects model world mutations and generates a fresh response after a natural-language event', async () => {
    const invalid = vi.fn(async () => ({
      ...(oneSegment as ReplyPlan),
      segments: [
        { ...oneSegment.segments[0], events: [{ type: 'photo', resourceId: 'fixture-photo' }] },
      ],
    }));
    const bad = setup(testProviders({ plan: invalid }));
    await expect(
      runConversation(
        bad.dependencies,
        bad.session,
        bad.turn,
        { kind: 'text', text: '你好' },
        bad.publish,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_PLAN' });
    expect(invalid).toHaveBeenCalledTimes(2);
    await bad.cleanup();
    const request = {
      actionId: 'move-counter',
      actionRequest: { quote: '去吧台吧', confirmed: true },
      segments: [],
      suggestions: [],
    };
    const latest = plannerOutput({
      ...(oneSegment as ReplyPlan),
      suggestions: [{ label: '饮品单', draft: '我想看看饮品单。' }],
    });
    const plan = vi
      .fn<ProviderSet['planner']['plan']>()
      .mockResolvedValueOnce(request)
      .mockResolvedValueOnce(request)
      .mockResolvedValueOnce(latest);
    const ctx = setup(testProviders({ plan }));
    await runConversation(
      ctx.dependencies,
      ctx.session,
      ctx.turn,
      { kind: 'text', text: '去吧台吧' },
      (event) => acknowledge(ctx, event),
    );
    expect(plan).toHaveBeenCalledTimes(3);
    expect(plan.mock.calls[2]?.[0]).toMatchObject({
      text: '去吧台吧',
      scene: { location: 'counter' },
    });
    expect(ctx.events.map((event) => event.type)).toEqual([
      'presentation.ready',
      'audio.ready',
      'reply.done',
    ]);
    expect(ctx.events.at(-1)).toMatchObject({
      type: 'reply.done',
      payload: { suggestions: [{ label: '饮品单', draft: '我想看看饮品单。' }] },
    });
    expect(ctx.session.story.location).toBe('counter');
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

// Regression sources only: runtime execution requires explicit user authorization.
describe('conversational action confirmation', () => {
  const text = '我们一起看看这张饮品单吧。';
  const proposal = {
    actionId: 'inspect-menu',
    actionRequest: { quote: text, confirmed: true },
    segments: [],
    suggestions: [],
  };
  function atCounter(providers: ProviderSet) {
    const ctx = setup(providers);
    ctx.session.narrative = followTo(ctx.session.narrative, 'first-counter');
    ctx.session.story = cafeScenario.frame(ctx.session.narrative).story;
    return ctx;
  }
  it('reviews explicit text intent inside Graph, then commits only receipt-confirmed beats', async () => {
    const plan = vi
      .fn<ProviderSet['planner']['plan']>()
      .mockResolvedValueOnce(proposal)
      .mockResolvedValueOnce(proposal)
      .mockResolvedValueOnce(plannerOutput(oneSegment as ReplyPlan));
    const ctx = atCounter(testProviders({ plan }));
    const presented = async (event: Pick<ServerEvent, 'type' | 'payload'>) => {
      await ctx.publish(event);
      const targets =
        event.type === 'audio.ready'
          ? [
              {
                targetId: (event.payload as import('@mira/protocol').AudioReadyPayload).segmentId,
                kind: 'segment' as const,
                mode: 'audio' as const,
              },
            ]
          : event.type === 'presentation.ready'
            ? (event.payload as import('@mira/protocol').PresentationReadyPayload).events.map(
                (item) => ({ targetId: item.eventId, kind: item.type }),
              )
            : [];
      ctx.dependencies.sessions.receipts(
        ctx.session,
        targets.map((target, index) => ({
          ...ctx.turn.identity,
          ...target,
          receiptId: `receipt-${ctx.events.length}-${index}`,
          status: 'presented',
        })),
      );
    };
    try {
      await runConversation(
        ctx.dependencies,
        ctx.session,
        ctx.turn,
        { kind: 'text', text },
        presented,
      );
      expect(plan).toHaveBeenCalledTimes(3);
      expect(plan.mock.calls[1]?.[0]).toMatchObject({
        allowedActions: [expect.objectContaining({ id: 'inspect-menu' })],
      });
      expect(ctx.session.story.revealed).toContain('menu');
      expect(ctx.events.at(-1)?.type).toBe('reply.done');
    } finally {
      await ctx.cleanup();
    }
  });
  it('turns an unconfirmed or ambiguous proposal into character dialogue without a world event', async () => {
    const ambiguous = '好';
    const plan = vi
      .fn<ProviderSet['planner']['plan']>()
      .mockResolvedValueOnce({ ...proposal, actionRequest: { quote: ambiguous, confirmed: true } })
      .mockResolvedValueOnce({ ...(oneSegment as ReplyPlan), actionId: null, actionRequest: null });
    const ctx = atCounter(testProviders({ plan }));
    try {
      await runConversation(
        ctx.dependencies,
        ctx.session,
        ctx.turn,
        { kind: 'text', text: ambiguous },
        ctx.publish,
      );
      expect(ctx.events.some((event) => event.type === 'presentation.ready')).toBe(false);
      expect(ctx.session.story.revealed).not.toContain('menu');
      expect(ctx.events.at(-1)?.type).toBe('reply.done');
    } finally {
      await ctx.cleanup();
    }
  });
  it('cannot execute an approval returned after a newer turn superseded confirmation', async () => {
    const reviewing = deferred<void>();
    const late = deferred<unknown>();
    const plan = vi
      .fn<ProviderSet['planner']['plan']>()
      .mockResolvedValueOnce(proposal)
      .mockImplementationOnce(async () => {
        reviewing.resolve();
        return late.promise;
      });
    const ctx = atCounter(testProviders({ plan }));
    try {
      const task = runConversation(
        ctx.dependencies,
        ctx.session,
        ctx.turn,
        { kind: 'text', text },
        ctx.publish,
      );
      const rejected = expect(task).rejects.toMatchObject({ code: 'TURN_CANCELLED' });
      await reviewing.promise;
      ctx.dependencies.sessions.begin(ctx.session, {
        generation: 2,
        turnId: 'newer',
        receipts: [],
        frozenTurns: [],
      });
      late.resolve(proposal);
      await rejected;
      expect(ctx.session.current?.identity.turnId).toBe('newer');
      expect(ctx.events).toHaveLength(0);
    } finally {
      await ctx.cleanup();
    }
  });
  it('rejects an action if its planning revision changed during confirmation', async () => {
    const ctx = atCounter(testProviders());
    let calls = 0;
    ctx.dependencies.providers.planner.plan = async () => {
      if (++calls === 2) {
        const beat = cafeScenario.propose('move-window-seat', ctx.session.narrative)[0]!;
        ctx.session.narrative = cafeScenario.accept(ctx.session.narrative, beat.checkpoint);
      }
      return proposal;
    };
    try {
      await expect(
        runConversation(
          ctx.dependencies,
          ctx.session,
          ctx.turn,
          { kind: 'text', text },
          ctx.publish,
        ),
      ).rejects.toMatchObject({ code: 'STALE_TURN' });
      expect(ctx.events).toHaveLength(0);
    } finally {
      await ctx.cleanup();
    }
  });
});

it('keeps a player message from becoming overheard dialogue during a private cutaway', async () => {
  const plan = vi.fn<ProviderSet['planner']['plan']>(async () => oneSegment);
  const ctx = setup(testProviders({ plan }));
  ctx.session.narrative = followTo(cafeScenario.initial(), 'first-mirror');
  ctx.session.story = cafeScenario.frame(ctx.session.narrative).story;
  const history = [...ctx.session.history];
  try {
    await expect(
      runConversation(
        ctx.dependencies,
        ctx.session,
        ctx.turn,
        { kind: 'text', text: '你在做什么？' },
        ctx.publish,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(plan).not.toHaveBeenCalled();
    expect(ctx.session.history).toEqual(history);
    expect(ctx.events.some((event) => event.type === 'audio.ready')).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

describe('character willingness and late contextual replies', () => {
  it('lets a UI proposal receive a cautious answer without granting attraction', async () => {
    const plan = vi.fn<ProviderSet['planner']['plan']>(async () =>
      plannerOutput({
        segments: [
          { text: '我还想先聊聊，慢慢认识吧。', emotion: 'curious', action: 'none', events: [] },
        ],
        suggestions: [],
      }),
    );
    const ctx = setup(testProviders({ plan }));
    const original = ctx.session.narrative;
    try {
      await runConversation(
        ctx.dependencies,
        ctx.session,
        ctx.turn,
        {
          kind: 'interaction',
          interaction: { kind: 'action', actionId: 'talk-spark', revision: original.revision },
        },
        ctx.publish,
      );
      expect(plan).toHaveBeenCalledOnce();
      expect(plan.mock.calls[0]?.[0].systemPrompt).toContain('点击只证明玩家提出该请求');
      expect(ctx.session.narrative).toEqual(original);
      expect(ctx.session.story.milestones).not.toContain('chemistry');
      expect(ctx.events.some((event) => event.type === 'presentation.ready')).toBe(false);
      expect(ctx.events[0]).toMatchObject({
        type: 'audio.ready',
        payload: { text: '我还想先聊聊，慢慢认识吧。' },
      });
    } finally {
      await ctx.cleanup();
    }
  });
  it('records mutual interest only after independent willingness review and the event receipt', async () => {
    let calls = 0;
    const ctx: ReturnType<typeof setup> = setup(
      testProviders({
        plan: async (input) => {
          calls++;
          if (calls === 1) {
            expect(ctx.session.story.milestones).not.toContain('chemistry');
            return {
              actionId: 'talk-spark',
              actionRequest: { quote: input.text, confirmed: true },
              segments: [],
              suggestions: [],
            };
          }
          expect(ctx.session.story.milestones).toContain('chemistry');
          return plannerOutput({
            segments: [
              { text: '我也想再认识你一点。', emotion: 'curious', action: 'none', events: [] },
            ],
            suggestions: [],
          });
        },
      }),
    );
    ctx.session.history.push(
      { role: 'user', text: '我也喜欢不赶路的散步。' },
      { role: 'assistant', text: '那下次有机会可以再一起走走。' },
    );
    try {
      await runConversation(
        ctx.dependencies,
        ctx.session,
        ctx.turn,
        {
          kind: 'interaction',
          interaction: {
            kind: 'action',
            actionId: 'talk-spark',
            revision: ctx.session.narrative.revision,
          },
        },
        (event) => acknowledge(ctx, event),
      );
      expect(calls).toBe(2);
      expect(ctx.session.story.milestones).toContain('chemistry');
      expect(ctx.session.story.milestones).not.toContain('appointment');
    } finally {
      await ctx.cleanup();
    }
  });
  it('preserves an already-presented movement while discarding a late reply from the cancelled turn', async () => {
    const began = deferred<void>();
    const late = deferred<unknown>();
    const ctx = setup(
      testProviders({
        plan: async () => {
          began.resolve();
          return late.promise;
        },
      }),
    );
    try {
      const task = runConversation(
        ctx.dependencies,
        ctx.session,
        ctx.turn,
        { kind: 'interaction', interaction: { kind: 'move', location: 'counter' } },
        (event) => acknowledge(ctx, event),
      );
      const rejected = expect(task).rejects.toMatchObject({ code: 'TURN_CANCELLED' });
      await began.promise;
      ctx.dependencies.sessions.begin(ctx.session, {
        generation: 2,
        turnId: 'newer',
        receipts: [],
        frozenTurns: [],
      });
      late.resolve(plannerOutput(oneSegment as ReplyPlan));
      await rejected;
      expect(ctx.session.story.location).toBe('counter');
      expect(ctx.session.current?.identity.turnId).toBe('newer');
      expect(
        ctx.events.some((event) => event.type === 'audio.ready' || event.type === 'reply.done'),
      ).toBe(false);
    } finally {
      await ctx.cleanup();
    }
  });
});
