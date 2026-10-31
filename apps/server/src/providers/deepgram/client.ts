import { boundedBody, withTimeout, type Fetch } from '../http.js';
import { ProviderError, type ProviderFailure } from '../types.js';

interface DeepgramClientOptions {
  apiKey: string;
  baseUrl: string;
}
interface RequestOptions {
  path: '/v1/listen' | '/v2/speak';
  query: Record<string, string>;
  body: BodyInit;
  mimeType: string;
  responseType: 'json' | 'audio';
  timeoutMs: number;
  maxBytes: number;
}
export interface DeepgramResponse {
  bytes: Uint8Array;
  mimeType: string;
  requestId?: string;
}

/** Shared transport only. Each adapter owns its product's request and response contract. */
export class DeepgramClient {
  constructor(
    private readonly options: DeepgramClientOptions,
    private readonly fetcher: Fetch = fetch,
  ) {}
  request(options: RequestOptions, signal: AbortSignal): Promise<DeepgramResponse> {
    let details: ProviderFailure = { provider: 'deepgram' };
    return withTimeout(signal, options.timeoutMs, async (combined) => {
      const url = new URL(options.path, this.options.baseUrl);
      for (const [key, value] of Object.entries(options.query)) url.searchParams.set(key, value);
      const response = await this.fetcher(url, {
        method: 'POST',
        redirect: 'error',
        signal: combined,
        headers: {
          Authorization: `Token ${this.options.apiKey}`,
          'Content-Type': options.mimeType,
          Accept: options.responseType === 'json' ? 'application/json' : 'audio/mpeg',
        },
        body: options.body,
      });
      if (combined.aborted) {
        await response.body?.cancel();
        combined.throwIfAborted();
      }
      const rawId = response.headers.get('dg-request-id');
      const requestId = rawId && /^[a-zA-Z0-9_-]{1,128}$/.test(rawId) ? rawId : undefined;
      details = {
        provider: 'deepgram',
        status: response.status,
        ...(requestId ? { requestId } : {}),
      };
      if (!response.ok) {
        await response.body?.cancel();
        throw new ProviderError('PROVIDER_FAILED', undefined, {
          ...details,
          retryable: response.status === 429 || response.status >= 500,
        });
      }
      const mimeType =
        response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
      if (
        options.responseType === 'json'
          ? mimeType !== 'application/json'
          : mimeType !== 'audio/mpeg'
      ) {
        await response.body?.cancel();
        throw new ProviderError(
          options.responseType === 'audio' ? 'INVALID_AUDIO' : 'PROVIDER_FAILED',
          undefined,
          details,
        );
      }
      const bytes = await boundedBody(response, options.maxBytes, combined);
      return { bytes, mimeType, ...(requestId ? { requestId } : {}) };
    }).catch((error: unknown) => {
      if (error instanceof ProviderError)
        throw new ProviderError(error.code, error.message, { ...details, ...error.details });
      throw error;
    });
  }
}
