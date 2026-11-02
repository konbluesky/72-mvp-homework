// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImageShare } from '@mira/protocol';
import { ApiClient, ApiError } from '../api/client.js';
import { MediaShareCoordinator } from './media-share-coordinator.js';
import { initialInteractiveState } from './state.js';
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
afterEach(() => vi.useRealTimers());
describe('image cancellation and session failure feedback', () => {
  it('keeps cancellation pending after transport failure and reconciles idempotently on the next poll', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    const cancelImage = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('NETWORK_UNAVAILABLE', 'offline', true))
      .mockResolvedValue({ ...share, version: 2, phase: 'cancelled' });
    const state = initialInteractiveState();
    state.connected = true;
    const coordinator = new MediaShareCoordinator(
      { cancelImage } as unknown as ApiClient,
      state,
      async () => false,
      () => undefined,
    );
    try {
      coordinator.setSession('session', [share]);
      await coordinator.cancel('share');
      expect(state.imageShares.share?.phase).toBe('preparing');
      expect(state.imageShares.share?.cancelRequested).toBe(true);
      await vi.advanceTimersByTimeAsync(500);
      expect(cancelImage).toHaveBeenCalledTimes(2);
      expect(state.imageShares.share?.phase).toBe('cancelled');
    } finally {
      coordinator.dispose();
    }
  });
  it('ends a card on an authenticated session-expired response instead of polling a permanent spinner', async () => {
    const state = initialInteractiveState();
    const coordinator = new MediaShareCoordinator(
      {
        cancelImage: vi.fn().mockRejectedValue(new ApiError('SESSION_EXPIRED', 'ended')),
      } as unknown as ApiClient,
      state,
      async () => false,
      () => undefined,
    );
    try {
      coordinator.setSession('session', [share]);
      await coordinator.cancel('share');
      expect(state.imageShares.share?.phase).toBe('expired');
      expect(state.imageShares.share?.cancelRequested).toBe(false);
      expect(state.imageShares.share?.networkError).toBe(false);
    } finally {
      coordinator.dispose();
    }
  });
  it('reclaims the private history-image URL when decoding fails', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:history-image');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const decode = vi
      .spyOn(HTMLImageElement.prototype, 'decode')
      .mockRejectedValue(new Error('DECODE_FAILED'));
    const state = initialInteractiveState();
    const coordinator = new MediaShareCoordinator(
      {
        image: vi.fn().mockResolvedValue(new Blob(['fixture'], { type: 'image/png' })),
      } as unknown as ApiClient,
      state,
      async () => false,
      () => undefined,
    );
    try {
      coordinator.setSession('session', [
        { ...share, phase: 'presented', presentedAt: 1, assetId: 'asset' },
      ]);
      await coordinator.restore(state.imageShares.share!);
      expect(state.imageShares.share?.display).toBe('load_failed');
      expect(revoke).toHaveBeenCalledWith('blob:history-image');
    } finally {
      coordinator.dispose();
      decode.mockRestore();
      revoke.mockRestore();
      create.mockRestore();
    }
  });
});
