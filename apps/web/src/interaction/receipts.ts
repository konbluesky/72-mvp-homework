import { sameTurn, type FrozenTurn, type Receipt, type TurnIdentity } from '@mira/protocol';

/** Bounded outbox plus immutable cancellation snapshots. No late callback may expand a frozen turn. */
export class ReceiptBook {
  private pending = new Map<string, Receipt>();
  private turns = new Map<string, Receipt[]>();
  private frozen = new Map<string, FrozenTurn>();
  record(receipt: Receipt): boolean {
    if (this.frozen.has(receipt.turnId)) return false;
    const receipts = this.turns.get(receipt.turnId) ?? [];
    if (
      receipts.some((item) => item.targetId === receipt.targetId && item.status === receipt.status)
    )
      return false;
    if (receipts.length >= 32 || this.pending.size >= 128) throw new Error('RECEIPT_CAPACITY');
    receipts.push(receipt);
    this.turns.set(receipt.turnId, receipts);
    this.pending.set(receipt.receiptId, receipt);
    return true;
  }
  freeze(turn: TurnIdentity): Receipt[] {
    const receipts = [...(this.turns.get(turn.turnId) ?? [])].filter((receipt) =>
      sameTurn(receipt, turn),
    );
    this.frozen.set(turn.turnId, { generation: turn.generation, turnId: turn.turnId, receipts });
    while (this.frozen.size > 8) {
      const oldest = this.frozen.keys().next().value;
      if (!oldest) break;
      this.frozen.delete(oldest);
      this.turns.delete(oldest);
    }
    return receipts;
  }
  acknowledge(ids: string[]): void {
    ids.forEach((id) => this.pending.delete(id));
  }
  outbox(): Receipt[] {
    return [...this.pending.values()];
  }
  snapshots(): FrozenTurn[] {
    return [...this.frozen.values()];
  }
  snapshot(turn: TurnIdentity): FrozenTurn {
    return {
      turnId: turn.turnId,
      generation: turn.generation,
      receipts: [...(this.turns.get(turn.turnId) ?? [])].filter((receipt) =>
        sameTurn(receipt, turn),
      ),
    };
  }
  /** Input has already passed the browser recovery schema and ownership checks. */
  restore(pending: Receipt[], snapshots: FrozenTurn[]): void {
    this.clear();
    for (const receipt of pending) {
      this.pending.set(receipt.receiptId, receipt);
      const items = this.turns.get(receipt.turnId) ?? [];
      items.push(receipt);
      this.turns.set(receipt.turnId, items);
    }
    for (const snapshot of snapshots) {
      this.turns.set(snapshot.turnId, [...snapshot.receipts]);
      this.frozen.set(snapshot.turnId, snapshot);
    }
  }
  clear(): void {
    this.pending.clear();
    this.turns.clear();
    this.frozen.clear();
  }
}
