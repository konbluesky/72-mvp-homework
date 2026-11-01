import { describe, expect, it } from 'vitest';
import type { Receipt } from '@mira/protocol';
import { ReceiptBook } from './receipts.js';
const receipt = (turnId: string, generation: number, targetId = 'photo'): Receipt => ({
  sessionId: 'session',
  turnId,
  generation,
  receiptId: `${turnId}_${targetId}`,
  targetId,
  kind: 'photo',
  status: 'presented',
});
describe('receipt outbox', () => {
  it('keeps unacknowledged presentations across three turns and rejects late additions to frozen snapshots', () => {
    const book = new ReceiptBook();
    const first = receipt('one', 1);
    const second = receipt('two', 2);
    const third = receipt('three', 3);
    book.record(first);
    book.freeze(first);
    book.record(second);
    book.freeze(second);
    book.record(third);
    expect(book.outbox()).toEqual([first, second, third]);
    expect(book.record(receipt('one', 1, 'late'))).toBe(false);
    expect(book.snapshots()[0]?.receipts).toEqual([first]);
    book.acknowledge([first.receiptId, second.receiptId]);
    expect(book.outbox()).toEqual([third]);
    expect(book.snapshots()[0]?.receipts).toEqual([first]);
  });
  it('deduplicates presented targets without changing existing facts', () => {
    const book = new ReceiptBook();
    const item = receipt('one', 1);
    expect(book.record(item)).toBe(true);
    expect(book.record({ ...item, receiptId: 'different' })).toBe(false);
    expect(book.outbox()).toHaveLength(1);
  });
  it('restores acknowledged receipts for cancellation without putting them back into the outbox', () => {
    const book = new ReceiptBook();
    const presented = receipt('one', 1);
    book.restore([], [{ turnId: 'one', generation: 1, receipts: [presented] }]);
    expect(book.outbox()).toEqual([]);
    expect(book.freeze(presented)).toEqual([presented]);
    expect(book.record(receipt('one', 1, 'late'))).toBe(false);
  });
});
