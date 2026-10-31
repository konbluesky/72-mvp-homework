import { expect, it, vi } from 'vitest';
import { timed } from './stages.js';
import { ProviderError } from '../providers/types.js';
it('records safe provider diagnostics without the private error text or credential', async () => {
  const info = vi.fn();
  const error = new ProviderError('PROVIDER_FAILED', 'private transcript and secret-key', {
    provider: 'deepgram',
    status: 401,
    requestId: 'safe-request',
    retryable: false,
  });
  await expect(
    timed({ info }, { sessionId: 'session', turnId: 'turn', generation: 1 }, 'stt', async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(info).toHaveBeenCalledWith(
    expect.objectContaining({
      stage: 'stt',
      outcome: 'failed',
      provider: 'deepgram',
      providerStatus: 401,
      providerRequestId: 'safe-request',
      retryable: false,
    }),
  );
  expect(JSON.stringify(info.mock.calls)).not.toContain('private transcript');
  expect(JSON.stringify(info.mock.calls)).not.toContain('secret-key');
});
