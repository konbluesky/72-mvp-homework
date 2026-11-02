import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Receipt } from '@mira/protocol';
import { SessionManager } from '../sessions/manager.js';
import { cafeScenario } from '../scenario/cafe/index.js';
import { testConfig } from '../../test/helpers.js';
import type { ImageRecipe } from './types.js';
const recipe: Omit<ImageRecipe, 'intent' | 'seed'> = {
  slotKey: 'keepsake',
  originLabel: '测试场景',
  title: '测试图片',
  character: 'adult',
  appearance: 'coat',
  location: 'window-seat',
  environment: 'rain',
  positive: 'portrait',
  negative: 'text',
  width: 1024,
  height: 1024,
  introduction: '等一下。',
  readyLine: '留个纪念。',
};
const managers: SessionManager[] = [];
function setup() {
  const scenario = {
    ...cafeScenario,
    imageSharing: { mockImage: 'unused', candidate: () => recipe, accepts: () => true },
  };
  const manager = new SessionManager(testConfig(), { scenario });
  managers.push(manager);
  const created = manager.create();
  const session = manager.authenticate(created.sessionId, `Bearer ${created.sessionToken}`);
  const start = vi.fn();
  manager.imageLifecycle = {
    start,
    removed: vi.fn(),
    discard: vi.fn(),
    assetAvailable: () => true,
  };
  session.confirmedConversation = {
    revision: session.narrative.revision,
    location: session.story.location,
  };
  manager.begin(session, { generation: 1, turnId: 'ordinary', receipts: [], frozenTurns: [] });
  const turn = session.current!;
  const work = manager.reserveImage(
    session,
    turn,
    { focus: 'environment', mood: 'quiet', framing: 'medium' },
    true,
  )!;
  manager.issueImageSlot(session, turn, work);
  manager.imageDecision(session, 'prepare');
  const receipt = (kind: Receipt['kind'], targetId: string, owner = turn): Receipt => ({
    ...owner.identity,
    receiptId: `receipt-${targetId}`,
    targetId,
    kind,
    status: 'presented',
  });
  return { manager, session, turn, work, start, receipt };
}
afterEach(() => {
  for (const manager of managers.splice(0)) manager.close();
});
describe('image sharing ownership and receipts', () => {
  it('does not submit before a visible slot and deduplicates replayed slot receipts', () => {
    const { manager, session, turn, work, start, receipt } = setup();
    expect(start).not.toHaveBeenCalled();
    const slot = receipt('image-slot', work.slotEventId);
    manager.receipts(session, [slot]);
    manager.receipts(session, [slot]);
    expect(start).toHaveBeenCalledTimes(1);
    expect(session.imageMemory).toEqual([]);
    manager.generated(turn);
    manager.begin(session, { generation: 2, turnId: 'next-user', receipts: [], frozenTurns: [] });
    expect(work.abort.signal.aborted).toBe(false);
    expect(work.slotConfirmed).toBe(true);
  });
  it('freezes an unseen slot without launching work or accepting late success', () => {
    const { manager, session, work, start, receipt } = setup();
    manager.cancelRequest(session, 'ordinary', 1, []);
    expect(start).not.toHaveBeenCalled();
    expect(work.share.phase).toBe('cancelled');
    expect(() => manager.receipts(session, [receipt('image-slot', work.slotEventId)])).toThrow();
    expect(session.imageShares.size).toBe(0);
    manager.begin(session, {
      generation: 2,
      turnId: 'next-after-unseen',
      receipts: [],
      frozenTurns: [],
    });
    const fresh = manager.reserveImage(
      session,
      session.current!,
      { focus: 'character', mood: 'warm', framing: 'portrait' },
      true,
    );
    expect(fresh).toBeDefined();
    expect(fresh!.share.shareId).not.toBe(work.share.shareId);
    expect(start).not.toHaveBeenCalled();
    expect(() => manager.receipts(session, [receipt('image-slot', work.slotEventId)])).toThrow();
    expect(session.imageShares.get(fresh!.share.shareId)).toBe(fresh);
  });
  it.each(['confirmed-slot', 'explicit-cancel'] as const)(
    'does not recycle the session allowance for a %s share on final freeze',
    (kind) => {
      const { manager, session, turn, work, receipt } = setup();
      if (kind === 'confirmed-slot')
        manager.receipts(session, [receipt('image-slot', work.slotEventId)]);
      else manager.endImage(session, work, 'cancelled');
      manager.cancelRequest(session, turn.identity.turnId, turn.identity.generation, []);
      expect(session.imageShares.get(work.share.shareId)).toBe(work);
      manager.begin(session, {
        generation: 2,
        turnId: 'later-input',
        receipts: [],
        frozenTurns: [],
      });
      expect(
        manager.reserveImage(
          session,
          session.current!,
          { focus: 'character', mood: 'warm', framing: 'portrait' },
          true,
        ),
      ).toBeUndefined();
    },
  );
  it('keeps a provisional unseen slot until the first final snapshot can confirm that it was actually visible', () => {
    const { manager, session, turn, work, start, receipt } = setup();
    manager.cancel(turn);
    expect(session.imageShares.get(work.share.shareId)).toBe(work);
    expect(start).not.toHaveBeenCalled();
    manager.cancelRequest(session, turn.identity.turnId, turn.identity.generation, [
      receipt('image-slot', work.slotEventId),
    ]);
    expect(work.slotConfirmed).toBe(true);
    expect(session.imageShares.get(work.share.shareId)).toBe(work);
    expect(start).toHaveBeenCalledTimes(1);
  });
  it('reclaims an expired unannounced reservation only once its source turn is finally frozen', () => {
    const { manager, session, turn, work, start, receipt } = setup();
    manager.endImage(session, work, 'expired');
    expect(session.imageShares.get(work.share.shareId)).toBe(work);
    manager.cancelRequest(session, turn.identity.turnId, turn.identity.generation, []);
    expect(session.imageShares.size).toBe(0);
    expect(start).not.toHaveBeenCalled();
    expect(() => manager.receipts(session, [receipt('image-slot', work.slotEventId)])).toThrow();
  });
  it('requires a completed ordinary presentation rather than any Ink/history line', () => {
    const { manager, session } = setup();
    session.confirmedConversation = undefined;
    session.history = [{ role: 'assistant', text: 'Ink line' }];
    expect(manager.imageCandidate(session)).toBeUndefined();
  });
  it('retains issued claims on provisional disconnect and commits only a frozen image success once', () => {
    const { manager, session, turn, work, receipt } = setup();
    manager.receipts(session, [receipt('image-slot', work.slotEventId)]);
    manager.generated(turn);
    manager.updateImage(
      session,
      work,
      work.share.attemptId,
      { phase: 'ready', assetId: 'image-asset' },
      'ready',
    );
    manager.imageDecision(session, 'keep');
    const response = manager.begin(session, {
      generation: 2,
      turnId: 'delivery',
      receipts: [],
      frozenTurns: [],
      mediaPresentation: {
        purpose: 'media-share',
        expectedGeneration: 1,
        shareId: work.share.shareId,
        expectedShareVersion: work.share.version,
      },
    });
    const delivery = session.current!;
    expect(response.claimId).toBeTruthy();
    manager.issueImage(session, delivery, work, 'image-event');
    manager.cancel(delivery);
    expect(work.claim?.id).toBe(response.claimId);
    const shown = receipt('image', 'image-event', delivery);
    manager.cancelRequest(session, 'delivery', 2, [shown]);
    manager.cancelRequest(session, 'delivery', 2, [shown]);
    expect(session.imageMemory).toHaveLength(1);
    expect(work.share.phase).toBe('presented');
    expect(session.facts).not.toHaveProperty('photo_seen', true);
  });
  it('reserves retry synchronously and lets cancellation beat a late provider completion', () => {
    const { manager, session, work, start, receipt } = setup();
    manager.receipts(session, [receipt('image-slot', work.slotEventId)]);
    const oldAttempt = work.share.attemptId;
    manager.updateImage(session, work, oldAttempt, { phase: 'failed' }, 'failed');
    const retry = { requestId: 'retry-once', expectedVersion: work.share.version };
    manager.retryImage(session, work, retry);
    manager.retryImage(session, work, retry);
    expect(start).toHaveBeenCalledTimes(2);
    expect(work.attemptCount).toBe(2);
    expect(work.share.attemptId).not.toBe(oldAttempt);
    manager.endImage(session, work, 'cancelled');
    expect(
      manager.updateImage(session, work, oldAttempt, { phase: 'ready', assetId: 'late' }, 'ready'),
    ).toBe(false);
    expect(work.share.phase).toBe('cancelled');
  });
  it('allows original-image reload after a frozen interrupted delivery with unpresented targets', () => {
    const { manager, session, turn, work, receipt } = setup();
    manager.receipts(session, [receipt('image-slot', work.slotEventId)]);
    manager.generated(turn);
    manager.updateImage(
      session,
      work,
      work.share.attemptId,
      { phase: 'ready', assetId: 'same-asset' },
      'ready',
    );
    const first = manager.begin(session, {
      generation: 2,
      turnId: 'first-delivery',
      receipts: [],
      frozenTurns: [],
      mediaPresentation: {
        purpose: 'media-share',
        expectedGeneration: 1,
        shareId: work.share.shareId,
        expectedShareVersion: work.share.version,
      },
    });
    const interrupted = session.current!;
    manager.issueImage(session, interrupted, work, 'unshown-image');
    manager.issue(session, interrupted, {
      segmentId: 'unspoken-intro',
      captionOnly: true,
      text: 'test',
      emotion: 'curious',
      action: 'none',
      events: [],
    });
    manager.cancelRequest(session, 'first-delivery', 2, []);
    const next = manager.begin(session, {
      generation: 3,
      turnId: 'reload',
      receipts: [],
      frozenTurns: [],
      mediaPresentation: {
        purpose: 'media-share',
        expectedGeneration: 2,
        shareId: work.share.shareId,
        expectedShareVersion: work.share.version,
      },
    });
    expect(next.claimId).toBeTruthy();
    expect(next.claimId).not.toBe(first.claimId);
    expect(work.share.assetId).toBe('same-asset');
    expect(work.attemptCount).toBe(1);
  });
  it('rejects stale automatic admission without cancelling a newer user turn', () => {
    const { manager, session, turn, work, receipt } = setup();
    manager.receipts(session, [receipt('image-slot', work.slotEventId)]);
    manager.generated(turn);
    manager.updateImage(
      session,
      work,
      work.share.attemptId,
      { phase: 'ready', assetId: 'asset' },
      'ready',
    );
    manager.begin(session, { generation: 3, turnId: 'new-user', receipts: [], frozenTurns: [] });
    const owner = session.current!;
    expect(() =>
      manager.begin(session, {
        generation: 4,
        turnId: 'late-auto',
        receipts: [],
        frozenTurns: [],
        mediaPresentation: {
          purpose: 'media-share',
          expectedGeneration: 1,
          shareId: work.share.shareId,
          expectedShareVersion: work.share.version,
        },
      }),
    ).toThrow();
    expect(session.current).toBe(owner);
    expect(owner.abort.signal.aborted).toBe(false);
  });
});
