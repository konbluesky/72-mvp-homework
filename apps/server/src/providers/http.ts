import { ProviderError } from './types.js';

export type Fetch = typeof globalThis.fetch;
export async function boundedBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  signal.throwIfAborted();
  const length = Number(response.headers.get('content-length'));
  if (length > maxBytes) {
    await response.body?.cancel();
    throw new ProviderError('PROVIDER_FAILED');
  }
  if (!response.body) throw new ProviderError('PROVIDER_FAILED');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ProviderError('PROVIDER_FAILED');
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
  if (total === 0) throw new ProviderError('PROVIDER_FAILED');
  return Buffer.concat(chunks, total);
}

export async function withTimeout<T>(
  signal: AbortSignal,
  ms: number,
  run: (combined: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeout = AbortSignal.timeout(ms);
  const combined = AbortSignal.any([signal, timeout]);
  combined.throwIfAborted();
  let rejectAbort: ((reason: unknown) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => {
    rejectAbort?.(combined.reason);
  };
  combined.addEventListener('abort', onAbort, { once: true });
  try {
    const result = await Promise.race([run(combined), aborted]);
    combined.throwIfAborted();
    return result;
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (timeout.aborted) throw new ProviderError('PROVIDER_TIMEOUT');
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('PROVIDER_FAILED');
  } finally {
    combined.removeEventListener('abort', onAbort);
  }
}
