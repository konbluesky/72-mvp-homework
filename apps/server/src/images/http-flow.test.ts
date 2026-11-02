import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SessionCreatedSchema,
  ServerEventSchema,
  type Receipt,
  type ServerEvent,
} from '@mira/protocol';
import { createApp } from '../app.js';
import { cafeScenario } from '../scenario/cafe/index.js';
import { advance } from '../scenario/cafe/story.test.helpers.js';
import { testConfig, testMedia, deferred } from '../../test/helpers.js';
import type { GeneratedImage } from './types.js';
import type { ProviderSet } from '../providers/types.js';
const apps: Array<Awaited<ReturnType<typeof createApp>>> = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
const frames = (payload: string) =>
  payload
    .split('\n\n')
    .filter((s) => s.startsWith('data: '))
    .map((s) => ServerEventSchema.parse(JSON.parse(s.slice(6))));
async function setup(extra: Record<string, string> = {}) {
  const config = testConfig({ MOCK_IMAGE_DELAY_MS: '100', IMAGE_JOB_TIMEOUT_MS: '5000', ...extra });
  const plan = vi.fn<ProviderSet['planner']['plan']>(async (input) => ({
    actionId: null,
    actionRequest: null,
    segments: [{ text: '雨声很好听。', emotion: 'curious', action: 'none', events: [] }],
    suggestions: [],
    mediaDecision: {
      decision:
        input.mediaCandidate &&
        typeof input.mediaCandidate === 'object' &&
        'candidate' in input.mediaCandidate &&
        input.mediaCandidate.candidate
          ? 'prepare'
          : 'keep',
      intent: { focus: 'environment', mood: 'quiet', framing: 'medium' },
    },
  }));
  const providers: ProviderSet = {
    planner: { info: { provider: 'test', model: 'offline' }, plan },
    tts: {
      info: { provider: 'text-only', model: 'captions' },
      synthesize: vi.fn(async () => {
        throw new Error('UNEXPECTED_TTS');
      }),
    },
  };
  const scenario = {
    ...cafeScenario,
    initial: () => advance(cafeScenario.initial('conversation'), 'talk-companionship'),
  };
  const app = await createApp({
    config,
    scenario,
    providers,
    media: testMedia(config),
    logger: false,
  });
  apps.push(app);
  const response = await app.inject({
    method: 'POST',
    url: '/api/sessions',
    payload: { entry: 'conversation' },
  });
  expect(response.statusCode).toBe(201);
  const created = SessionCreatedSchema.parse(response.json());
  const base = `/api/sessions/${created.sessionId}`;
  const headers = {
    authorization: `Bearer ${created.sessionToken}`,
    'x-session-id': created.sessionId,
  };
  let generation = 0;
  async function begin(mediaPresentation?: {
    purpose: 'media-share';
    shareId: string;
    expectedShareVersion: number;
    expectedGeneration: number;
  }) {
    generation++;
    const turnId = `turn-${generation}`;
    const response = await app.inject({
      method: 'POST',
      url: `${base}/turns`,
      headers,
      payload: { turnId, generation, ...(mediaPresentation ? { mediaPresentation } : {}) },
    });
    expect(response.statusCode, response.payload).toBe(200);
    return { ...response.json(), turnId, generation };
  }
  async function input(
    turn: { turnId: string; generation: number },
    content: Record<string, unknown>,
  ) {
    const response = await app.inject({
      method: 'POST',
      url: `${base}/turns/${turn.turnId}/input`,
      headers,
      payload: { generation: turn.generation, inputId: `input-${turn.generation}`, ...content },
    });
    expect(response.statusCode, response.payload).toBe(200);
    return frames(response.payload);
  }
  function receipts(
    turn: { turnId: string; generation: number },
    events: ServerEvent[],
    includeSlot = true,
  ): Receipt[] {
    const targets = events.flatMap<{
      targetId: string;
      kind: Receipt['kind'];
      mode?: Receipt['mode'];
    }>((event) =>
      event.type === 'audio.ready' || event.type === 'text.ready'
        ? [{ targetId: event.payload.segmentId, kind: 'segment' as const, mode: 'text' as const }]
        : event.type === 'image.pending'
          ? [
              {
                targetId: event.payload.introduction.segmentId,
                kind: 'segment' as const,
                mode: 'text' as const,
              },
              ...(includeSlot
                ? [{ targetId: event.payload.slotEventId, kind: 'image-slot' as const }]
                : []),
            ]
          : event.type === 'presentation.ready'
            ? event.payload.events.map((effect) => ({
                targetId: effect.eventId,
                kind: effect.type,
              }))
            : [],
    );
    return targets.map((target) => ({
      ...target,
      sessionId: created.sessionId,
      generation: turn.generation,
      turnId: turn.turnId,
      receiptId: `r-${target.targetId}`,
      status: 'presented' as const,
    }));
  }
  async function submitReceipts(values: Receipt[]) {
    const r = await app.inject({
      method: 'POST',
      url: `${base}/receipts`,
      headers,
      payload: { receipts: values },
    });
    expect(r.statusCode, r.payload).toBe(200);
  }
  async function presentedInput(
    turn: { turnId: string; generation: number },
    content: Record<string, unknown>,
  ) {
    const origin = await app.listen({ port: 0, host: '127.0.0.1' });
    const response = await fetch(`${origin}${base}/turns/${turn.turnId}/input`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        generation: turn.generation,
        inputId: `stream-input-${turn.generation}`,
        ...content,
      }),
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const output: ServerEvent[] = [];
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, boundary + 2);
          buffer = buffer.slice(boundary + 2);
          for (const event of frames(chunk)) {
            output.push(event);
            if (event.type === 'error') throw new Error(event.payload.code);
            const confirmed = receipts(turn, [event]);
            if (confirmed.length) await submitReceipts(confirmed);
          }
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    expect(output.at(-1)?.type).toBe('reply.done');
    return output;
  }
  const query = async (id: string) =>
    (await app.inject({ url: `${base}/image-shares/${id}`, headers })).json();
  async function announce() {
    const first = await begin();
    const one = await input(first, { text: '我们可以听一会雨。' });
    expect(one.some((e) => e.type === 'image.pending')).toBe(false);
    await submitReceipts(receipts(first, one));
    const second = await begin();
    const two = await input(second, { text: '雨窗让今晚很安静。' });
    const pending = two.find(
      (e): e is Extract<ServerEvent, { type: 'image.pending' }> => e.type === 'image.pending',
    );
    expect(pending).toBeDefined();
    return { turn: second, events: two, pending: pending! };
  }
  return {
    app,
    base,
    headers,
    created,
    plan,
    begin,
    input,
    presentedInput,
    receipts,
    submitReceipts,
    query,
    announce,
  };
}
describe('offline HTTP image-sharing lifecycle with the deployed Mock image', () => {
  it('waits for slot receipt, survives a new chat, generates a validated private PNG and commits memory only from image receipt', async () => {
    const h = await setup();
    const generate = vi.spyOn(h.app.services.images.provider!, 'generate');
    const a = await h.announce();
    expect(generate).not.toHaveBeenCalled();
    await h.submitReceipts(h.receipts(a.turn, a.events, false));
    expect(generate).not.toHaveBeenCalled();
    const slot = h.receipts(a.turn, a.events).filter((r) => r.kind === 'image-slot');
    await h.submitReceipts(slot);
    await h.submitReceipts(slot);
    expect(generate).toHaveBeenCalledTimes(1);
    const next = await h.begin();
    const chat = await h.input(next, { text: '不用等照片，我们可以继续聊。' });
    await h.submitReceipts(h.receipts(next, chat));
    const id = a.pending.payload.share.shareId;
    await vi.waitFor(async () => expect((await h.query(id)).phase).toBe('ready'), {
      timeout: 5000,
      interval: 30,
    });
    const state = await h.query(id);
    expect(state.assetId).toBeUndefined();
    expect(state.simulated).toBe(true);
    const present = await h.begin({
      purpose: 'media-share',
      shareId: id,
      expectedShareVersion: state.version,
      expectedGeneration: next.generation,
    });
    const planned = h.plan.mock.calls.length;
    const output = await h.input(present, {
      media: { kind: 'image-share', shareId: id, claimId: present.claimId },
    });
    expect(h.plan).toHaveBeenCalledTimes(planned);
    const ready = output.find(
      (event): event is Extract<ServerEvent, { type: 'image.ready' }> =>
        event.type === 'image.ready',
    )!;
    expect(ready).toBeDefined();
    const image = await h.app.inject({
      url: `/api/media/${ready.payload.assetId}`,
      headers: h.headers,
    });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toContain('image/png');
    expect([...image.rawPayload.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(
      (
        await h.app.inject({
          url: `/api/media/${ready.payload.assetId}`,
          headers: { 'x-session-id': h.created.sessionId },
        })
      ).statusCode,
    ).toBe(401);
    const session = h.app.services.sessions.authenticate(
      h.created.sessionId,
      h.headers.authorization,
    );
    expect(session.imageMemory).toEqual([]);
    const shown: Receipt = {
      sessionId: h.created.sessionId,
      generation: present.generation,
      turnId: present.turnId,
      receiptId: 'shown',
      targetId: ready.payload.imageEventId,
      kind: 'image',
      status: 'presented',
    };
    await h.submitReceipts([shown, shown]);
    expect(session.imageMemory).toHaveLength(1);
    expect((await h.query(id)).phase).toBe('presented');
    expect(session.facts.photo_revealed).toBe(false);
  });
  it('allows one manual new attempt after definite failure, and cancellation prevents a late successful image from reviving it', async () => {
    const h = await setup({ MOCK_IMAGE_FAILURE: 'first', MOCK_IMAGE_DELAY_MS: '100' });
    const generate = vi.spyOn(h.app.services.images.provider!, 'generate');
    const a = await h.announce();
    await h.submitReceipts(h.receipts(a.turn, a.events));
    const id = a.pending.payload.share.shareId;
    await vi.waitFor(async () => expect((await h.query(id)).phase).toBe('failed'), {
      timeout: 5000,
      interval: 25,
    });
    const failed = await h.query(id);
    const retry = await h.app.inject({
      method: 'POST',
      url: `${h.base}/image-shares/${id}/retry`,
      headers: h.headers,
      payload: { requestId: 'retry', expectedVersion: failed.version },
    });
    expect(retry.statusCode).toBe(200);
    const repeated = await h.app.inject({
      method: 'POST',
      url: `${h.base}/image-shares/${id}/retry`,
      headers: h.headers,
      payload: { requestId: 'retry', expectedVersion: failed.version },
    });
    expect(repeated.statusCode).toBe(200);
    expect(generate).toHaveBeenCalledTimes(2);
    const cancel = await h.app.inject({
      method: 'POST',
      url: `${h.base}/image-shares/${id}/cancel`,
      headers: h.headers,
    });
    expect(cancel.json().phase).toBe('cancelled');
    await vi.waitFor(() => expect(h.app.services.media.stats().assets).toBe(0), {
      timeout: 1000,
      interval: 30,
    });
    expect((await h.query(id)).phase).toBe('cancelled');
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it('expires a slow image job on its independent deadline without failing the conversation', async () => {
    const h = await setup({ IMAGE_JOB_TIMEOUT_MS: '350', MOCK_IMAGE_DELAY_MS: '1000' });
    const generate = vi.spyOn(h.app.services.images.provider!, 'generate');
    const a = await h.announce();
    await h.submitReceipts(h.receipts(a.turn, a.events));
    const id = a.pending.payload.share.shareId;
    expect(generate).toHaveBeenCalledTimes(1);
    await vi.waitFor(async () => expect((await h.query(id)).phase).toBe('expired'), {
      timeout: 1500,
      interval: 20,
    });
    const next = await h.begin();
    const events = await h.input(next, { text: '我们继续聊吧。' });
    expect(events.at(-1)?.type).toBe('reply.done');
    expect(h.app.services.media.stats().assets).toBe(0);
  });
  it('only offers the authored sharing intention after a complete ordinary presentation, not a partial reply', async () => {
    const h = await setup();
    h.plan.mockResolvedValueOnce({
      actionId: null,
      actionRequest: null,
      segments: [
        { text: '先听你说。', emotion: 'curious', action: 'none', events: [] },
        { text: '再慢慢接着聊。', emotion: 'curious', action: 'none', events: [] },
      ],
      suggestions: [],
      mediaDecision: {
        decision: 'keep',
        intent: { focus: 'environment', mood: 'quiet', framing: 'medium' },
      },
    });
    const first = await h.begin();
    const reply = await h.input(first, { text: '我想聊聊平时的生活。' });
    expect(h.plan.mock.calls[0]?.[0].mediaCandidate).toMatchObject({ candidate: null });
    const partial = h.receipts(first, reply).slice(0, 1);
    expect(partial).toHaveLength(1);
    await h.submitReceipts(partial);
    const second = await h.begin();
    const incomplete = await h.input(second, { text: '刚才那句还没有全部听完。' });
    expect(h.plan.mock.calls[1]?.[0].mediaCandidate).toMatchObject({ candidate: null });
    expect(incomplete.some((event) => event.type === 'image.pending')).toBe(false);
    await h.submitReceipts(h.receipts(second, incomplete));
    const third = await h.begin();
    const complete = await h.input(third, { text: '现在可以自然接着聊了。' });
    const pending = complete.find(
      (event): event is Extract<ServerEvent, { type: 'image.pending' }> =>
        event.type === 'image.pending',
    )!;
    expect(pending).toBeDefined();
    const candidate = (
      h.plan.mock.calls[2]?.[0].mediaCandidate as {
        candidate: {
          available: boolean;
          title: string;
          originLabel: string;
          sharingIntention: string;
        };
      }
    ).candidate;
    expect(candidate.available).toBe(true);
    expect(candidate.title).toBe(pending.payload.share.title);
    expect(candidate.originLabel).toBe(pending.payload.share.originLabel);
    expect(candidate.sharingIntention).toBe(pending.payload.introduction.text);
    expect(candidate.sharingIntention.length).toBeGreaterThan(0);
    expect(candidate).not.toHaveProperty('positive');
    expect(candidate).not.toHaveProperty('assetId');
  });
  it.each(['preparing', 'ready'] as const)(
    'retains the original %s share after a legal talk action with keep and grants its media lease without generating again',
    async (phase) => {
      const h = await setup({ MOCK_IMAGE_DELAY_MS: '500' });
      const generate = vi.spyOn(h.app.services.images.provider!, 'generate');
      const a = await h.announce();
      await h.submitReceipts(h.receipts(a.turn, a.events));
      const shareId = a.pending.payload.share.shareId;
      if (phase === 'ready')
        await vi.waitFor(async () => expect((await h.query(shareId)).phase).toBe('ready'), {
          timeout: 5000,
          interval: 20,
        });
      else expect((await h.query(shareId)).phase).toBe('preparing');
      const text = '我不赶时间，你慢慢说。';
      h.plan.mockResolvedValueOnce({
        actionId: 'talk-waiting',
        actionRequest: { quote: text, confirmed: true },
        segments: [],
        suggestions: [],
        mediaDecision: { decision: 'keep', intent: null },
      });
      const talk = await h.begin();
      const events = await h.presentedInput(talk, { text });
      expect(events.some((event) => event.type === 'presentation.ready')).toBe(true);
      expect(events.some((event) => event.type === 'image.pending')).toBe(false);
      await h.submitReceipts(h.receipts(talk, events));
      await vi.waitFor(async () => expect((await h.query(shareId)).phase).toBe('ready'), {
        timeout: 5000,
        interval: 20,
      });
      const session = h.app.services.sessions.authenticate(
        h.created.sessionId,
        h.headers.authorization,
      );
      const work = session.imageShares.get(shareId)!;
      const originalAsset = work.share.assetId;
      const attemptId = work.share.attemptId;
      const ready = await h.query(shareId);
      const presentation = await h.begin({
        purpose: 'media-share',
        shareId,
        expectedShareVersion: ready.version,
        expectedGeneration: talk.generation,
      });
      expect(presentation.claimId).toBeTruthy();
      const planned = h.plan.mock.calls.length;
      const output = await h.input(presentation, {
        media: { kind: 'image-share', shareId, claimId: presentation.claimId },
      });
      const image = output.find(
        (event): event is Extract<ServerEvent, { type: 'image.ready' }> =>
          event.type === 'image.ready',
      )!;
      expect(image.payload.assetId).toBe(originalAsset);
      expect(work.share.attemptId).toBe(attemptId);
      expect(work.attemptCount).toBe(1);
      expect(generate).toHaveBeenCalledTimes(1);
      expect(h.plan).toHaveBeenCalledTimes(planned);
    },
  );
  it('cancels an in-flight share when the same legal talk action carries dismiss and rejects a late provider success', async () => {
    const h = await setup();
    const late = deferred<GeneratedImage>();
    const sample = await readFile('assets/images/window-keepsake-mock.webp');
    const generate = vi
      .spyOn(h.app.services.images.provider!, 'generate')
      .mockImplementationOnce(async () => late.promise);
    let shareId = '';
    try {
      const a = await h.announce();
      shareId = a.pending.payload.share.shareId;
      await h.submitReceipts(h.receipts(a.turn, a.events));
      expect(generate).toHaveBeenCalledTimes(1);
      const text = '我不赶时间，你慢慢说，照片就不要了。';
      h.plan.mockResolvedValueOnce({
        actionId: 'talk-waiting',
        actionRequest: { quote: text, confirmed: true },
        segments: [],
        suggestions: [],
        mediaDecision: { decision: 'dismiss', intent: null },
      });
      const talk = await h.begin();
      const events = await h.presentedInput(talk, { text });
      expect(events.some((event) => event.type === 'presentation.ready')).toBe(true);
      await h.submitReceipts(h.receipts(talk, events));
      expect((await h.query(shareId)).phase).toBe('cancelled');
    } finally {
      late.resolve({ bytes: sample, mimeType: 'image/png' });
      await h.app.services.images.close();
    }
    expect((await h.query(shareId)).phase).toBe('cancelled');
    expect(h.app.services.media.stats().assets).toBe(0);
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
