import { describe, expect, it } from 'vitest';
import type { ImageShare } from '@mira/protocol';
import { mergeImageShare, retainReading } from './conversation-items.js';
const share: ImageShare = {
  shareId: 'share',
  attemptId: 'attempt',
  version: 1,
  phase: 'preparing',
  originLabel: 'test',
  title: 'test',
  width: 1024,
  height: 1024,
  announcedAt: 1,
  expiresAt: 10000,
  simulated: true,
  canRetryGeneration: false,
  longWait: false,
};
describe('shared image view projection', () => {
  it('does not revive cancellation or replace newer attempts with stale polling', () => {
    const first = mergeImageShare(undefined, share)!;
    const cancelled = mergeImageShare(first, { ...share, version: 4, phase: 'cancelled' })!;
    expect(mergeImageShare(cancelled, { ...share, version: 3, phase: 'ready' })).toBe(cancelled);
    const retry = mergeImageShare(first, { ...share, attemptId: 'attempt2', version: 6 })!;
    expect(mergeImageShare(retry, { ...share, version: 5, phase: 'failed' })).toBe(retry);
  });
  it('retains a media reference through the sixty-line reading limit without duplicating task state', () => {
    const entries: Array<{ id: number; shareId?: string }> = [
      { id: 1, shareId: 'share' },
      ...Array.from({ length: 100 }, (_, i) => ({ id: i + 2 })),
    ];
    const kept = retainReading(entries);
    expect(kept).toHaveLength(60);
    expect(kept[0]?.shareId).toBe('share');
    expect(kept.at(-1)?.id).toBe(101);
  });
});
