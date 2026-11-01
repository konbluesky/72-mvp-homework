import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ReplyPlanSchema,
  ConnectionEventSchema,
  ConnectionProbeSchema,
  ServerEventSchema,
  ReceiptSchema,
  ReplySuggestionSchema,
  BeginTurnSchema,
  MessageAttemptSchema,
  SessionExpirySchema,
  CreateSessionSchema,
} from './index.js';

describe('network schemas', () => {
  it('represents unlimited retention explicitly and validates restart session identifiers', () => {
    expect(SessionExpirySchema.parse(null)).toBeNull();
    expect(SessionExpirySchema.parse(1_800_000_000_000)).toBe(1_800_000_000_000);
    for (const value of [0, -1, Infinity, 'never'])
      expect(SessionExpirySchema.safeParse(value).success).toBe(false);
    expect(CreateSessionSchema.parse({ replaceSessionId: 'old-session' })).toEqual({
      entry: 'story',
      replaceSessionId: 'old-session',
    });
    expect(CreateSessionSchema.safeParse({ replaceSessionId: '../another' }).success).toBe(false);
    expect(
      CreateSessionSchema.safeParse({ replaceSessionId: 'session', token: 'secret' }).success,
    ).toBe(false);
  });
  it('accepts message identity on begin and rejects extra retry commands or malformed attempt results', () => {
    const begin = { generation: 2, turnId: 'retry', messageId: 'message' };
    expect(BeginTurnSchema.safeParse(begin).success).toBe(true);
    expect(BeginTurnSchema.safeParse({ ...begin, replay: true }).success).toBe(false);
    const result = {
      sessionId: 'session',
      ...begin,
      status: 'failed',
      presented: false,
      retryable: true,
      error: '服务失败',
    };
    expect(MessageAttemptSchema.safeParse(result).success).toBe(true);
    expect(MessageAttemptSchema.safeParse({ ...result, url: 'https://example.com' }).success).toBe(
      false,
    );
    expect(MessageAttemptSchema.safeParse({ ...result, messageId: '../message' }).success).toBe(
      false,
    );
  });
  it('requires bounded user reply suggestions in plans and rejects executable extra fields', () => {
    const plan: unknown = JSON.parse(readFileSync('tests/fixtures/valid-plan.json', 'utf8'));
    const parsed = ReplyPlanSchema.parse(plan);
    expect(ReplyPlanSchema.safeParse({ segments: parsed.segments }).success).toBe(false);
    expect(
      ReplyPlanSchema.safeParse({
        ...parsed,
        suggestions: Array.from({ length: 4 }, () => ({ label: '继续聊', draft: '然后呢？' })),
      }).success,
    ).toBe(false);
    expect(ReplySuggestionSchema.safeParse({ label: ' ', draft: '然后呢？' }).success).toBe(false);
    expect(
      ReplySuggestionSchema.safeParse({ label: '继续聊', draft: '字'.repeat(121) }).success,
    ).toBe(false);
    expect(
      ReplySuggestionSchema.safeParse({ label: '看看', draft: '然后呢？', action: 'offerPhoto' })
        .success,
    ).toBe(false);
  });
  it('validates the maintained plan fixtures and rejects executable or remote resources', () => {
    expect(
      ReplyPlanSchema.safeParse(JSON.parse(readFileSync('tests/fixtures/valid-plan.json', 'utf8')))
        .success,
    ).toBe(true);
    expect(
      ReplyPlanSchema.safeParse(
        JSON.parse(readFileSync('tests/fixtures/invalid-plan.json', 'utf8')),
      ).success,
    ).toBe(false);
  });
  it('rejects unknown schema versions, missing turn identity and oversized plans', () => {
    expect(
      ServerEventSchema.safeParse({
        type: 'reply.done',
        schemaVersion: 3,
        payload: { segmentCount: 0 },
      }).success,
    ).toBe(false);
    expect(
      ReplyPlanSchema.safeParse({
        suggestions: [],
        segments: Array.from({ length: 5 }, () => ({
          text: '雨',
          emotion: 'curious',
          action: 'none',
          events: [],
        })),
      }).success,
    ).toBe(false);
  });
  it('does not accept arbitrary client facts in a receipt', () => {
    expect(
      ReceiptSchema.safeParse({
        receiptId: 'r1',
        sessionId: 's1',
        generation: 1,
        turnId: 't1',
        targetId: 'e1',
        kind: 'photo',
        status: 'presented',
        fact: 'other',
      }).success,
    ).toBe(false);
  });
});

describe('stateless monitoring contract', () => {
  it('rejects unknown commands, sequence errors and credentials in health frames', () => {
    const frame = {
      schemaVersion: 3,
      type: 'connection.ready',
      connectionId: 'monitor',
      seq: 1,
      status: 'ready',
      heartbeatIntervalMs: 5000,
    };
    expect(ConnectionEventSchema.safeParse(frame).success).toBe(true);
    for (const extra of [
      { seq: 0 },
      { type: 'turn.begin' },
      { sessionToken: 'private' },
      { heartbeatIntervalMs: 1 },
    ])
      expect(ConnectionEventSchema.safeParse({ ...frame, ...extra }).success).toBe(false);
    expect(
      ConnectionProbeSchema.safeParse({ schemaVersion: 3, status: 'ok', token: 'private' }).success,
    ).toBe(false);
  });
});

it('rejects executable story targets and accepts independent presentation without an audio URL', async () => {
  const { JsonInputSchema, PresentationReadyPayloadSchema, SCHEMA_VERSION } =
    await import('./index.js');
  expect(SCHEMA_VERSION).toBe(3);
  expect(
    JsonInputSchema.safeParse({
      generation: 1,
      inputId: 'input',
      interaction: { kind: 'move', location: 'https://evil.invalid' },
    }).success,
  ).toBe(false);
  expect(
    JsonInputSchema.safeParse({
      generation: 1,
      inputId: 'input',
      interaction: { kind: 'inspect', prop: 'letter', script: 'run' },
    }).success,
  ).toBe(false);
  expect(
    PresentationReadyPayloadSchema.parse({
      presentationId: 'move',
      caption: '进入大堂',
      events: [{ eventId: 'arrive', type: 'location', location: 'lobby' }],
    }).events,
  ).toHaveLength(1);
});
