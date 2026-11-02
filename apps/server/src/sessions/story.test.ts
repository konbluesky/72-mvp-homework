import { describe, expect, it } from 'vitest';
import { SessionManager } from './manager.js';
import { testConfig } from '../../test/helpers.js';
import { cafeScenario } from '../scenario/cafe/index.js';
import type { Receipt, PresentationEvent } from '@mira/protocol';

function setup() {
  const manager = new SessionManager(testConfig(), { scenario: cafeScenario });
  const created = manager.create();
  const session = manager.authenticate(created.sessionId, `Bearer ${created.sessionToken}`);
  manager.begin(session, { generation: 1, turnId: 'first', receipts: [], frozenTurns: [] });
  const turn = manager.getTurn(session, 'first', 1);
  const beat = cafeScenario.propose('move-counter', session.narrative)[0]!;
  const event = { ...beat.event, eventId: 'arrive' } as PresentationEvent;
  manager.issueEvents(session, turn, [event], true, [], beat.checkpoint);
  const receipt: Receipt = {
    ...turn.identity,
    targetId: 'arrive',
    receiptId: 'r1',
    kind: event.type,
    status: 'presented',
  };
  return { manager, session, turn, receipt };
}
describe('receipt-confirmed Ink checkpoints', () => {
  it('does not commit a calculated story before the issued presentation is acknowledged', () => {
    const f = setup();
    expect(f.session.story.location).toBe('lobby');
    f.manager.receipts(f.session, [f.receipt]);
    expect(f.session.story.location).toBe('counter');
    expect(f.session.story.phase).toBe('exploration');
    expect(f.session.narrative.revision).toBe(1);
    f.manager.receipts(f.session, [f.receipt]);
    expect(f.session.narrative.revision).toBe(1);
    f.manager.close();
  });
  it('freezes a cancelled round and rejects a late successful effect outside its snapshot', () => {
    const f = setup();
    f.manager.cancelRequest(f.session, 'first', 1, []);
    expect(() => f.manager.receipts(f.session, [f.receipt])).toThrow();
    expect(f.session.narrative.revision).toBe(0);
    expect(f.session.story.location).toBe('lobby');
    f.manager.close();
  });
  it('keeps a confirmed prefix when a new generation changes direction and ignores acknowledged old duplicates', () => {
    const f = setup();
    f.manager.receipts(f.session, [f.receipt]);
    f.manager.begin(f.session, {
      generation: 2,
      turnId: 'second',
      receipts: [],
      frozenTurns: [{ generation: 1, turnId: 'first', receipts: [f.receipt] }],
    });
    const turn = f.manager.getTurn(f.session, 'second', 2);
    const beat = cafeScenario.propose('move-window-seat', f.session.narrative)[0]!;
    const event = { ...beat.event, eventId: 'counter' } as PresentationEvent;
    f.manager.issueEvents(f.session, turn, [event], true, [], beat.checkpoint);
    f.manager.receipts(f.session, [
      {
        ...turn.identity,
        targetId: 'counter',
        receiptId: 'r2',
        kind: event.type,
        status: 'presented',
      },
    ]);
    f.manager.receipts(f.session, [f.receipt]);
    expect(f.session.story.location).toBe('window-seat');
    expect(f.session.story.revealed).toEqual([]);
    expect(f.session.narrative.revision).toBe(2);
    f.manager.close();
  });
});
