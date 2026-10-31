import { performance } from 'node:perf_hooks';
import { ProviderError } from '../providers/types.js';

export interface StageLogger {
  info(fields: Record<string, unknown>, message?: string): void;
}

/** Timings deliberately contain no user text, recordings, credentials, or provider bodies. */
export async function timed<T>(
  logger: StageLogger,
  identity: { sessionId: string; turnId: string; generation: number },
  stage: string,
  operation: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  try {
    const value = await operation();
    logger.info({
      ...identity,
      stage,
      durationMs: Math.round(performance.now() - started),
      outcome: 'ok',
    });
    return value;
  } catch (error) {
    logger.info({
      ...identity,
      stage,
      durationMs: Math.round(performance.now() - started),
      outcome: 'failed',
      ...(error instanceof ProviderError
        ? {
            provider: error.details.provider ?? 'unknown',
            providerStatus: error.details.status ?? 'unknown',
            providerRequestId: error.details.requestId ?? 'unknown',
            code: error.code,
            retryable: error.retryable,
          }
        : {}),
    });
    throw error;
  }
}
