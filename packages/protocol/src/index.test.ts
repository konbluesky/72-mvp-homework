import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ReplyPlanSchema, ServerEventSchema, ReceiptSchema } from './index.js';

describe('network schemas', () => {
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
        schemaVersion: 2,
        payload: { segmentCount: 0 },
      }).success,
    ).toBe(false);
    expect(
      ReplyPlanSchema.safeParse({
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
