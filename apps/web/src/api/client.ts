import {
  BeginTurnResponseSchema,
  HttpErrorSchema,
  ReceiptsResponseSchema,
  SessionCreatedSchema,
  SessionSnapshotSchema,
  type FrozenTurn,
  type Receipt,
  type SessionCreated,
  type TurnIdentity,
} from '@mira/protocol';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}
interface Schema<T> {
  parse(value: unknown): T;
}

export class ApiClient {
  private session?: SessionCreated;
  readonly base: string;
  constructor(
    base = import.meta.env.VITE_API_BASE_URL || window.location.origin,
    private readonly fetcher: typeof fetch = fetch.bind(globalThis),
  ) {
    const url = new URL(base, window.location.origin);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/'
    )
      throw new Error('API 地址必须为 HTTP(S) origin');
    this.base = url.origin;
  }
  async createSession(signal?: AbortSignal): Promise<SessionCreated> {
    const session = await this.json('/api/sessions', SessionCreatedSchema, {
      method: 'POST',
      signal,
    });
    signal?.throwIfAborted();
    this.session = session;
    return session;
  }
  clear(): void {
    this.session = undefined;
  }
  snapshot(signal?: AbortSignal) {
    return this.json(`/api/sessions/${this.requireSession().sessionId}`, SessionSnapshotSchema, {
      signal,
    });
  }
  begin(turn: TurnIdentity, receipts: Receipt[], frozenTurns: FrozenTurn[], signal: AbortSignal) {
    return this.json(`/api/sessions/${turn.sessionId}/turns`, BeginTurnResponseSchema, {
      method: 'POST',
      signal,
      body: JSON.stringify({
        generation: turn.generation,
        turnId: turn.turnId,
        receipts,
        frozenTurns,
      }),
    });
  }
  async cancel(turn: TurnIdentity, receipts: Receipt[]): Promise<void> {
    const response = await this.request(
      `/api/sessions/${turn.sessionId}/turns/${turn.turnId}/cancel`,
      {
        method: 'POST',
        body: JSON.stringify({ generation: turn.generation, receipts, frozen: true }),
      },
    );
    await response.arrayBuffer();
  }
  receipts(receipts: Receipt[]) {
    return this.json(
      `/api/sessions/${this.requireSession().sessionId}/receipts`,
      ReceiptsResponseSchema,
      { method: 'POST', body: JSON.stringify({ receipts }) },
    );
  }
  input(
    turn: TurnIdentity,
    input: string | { blob: Blob; durationMs: number },
    inputId: string,
    signal: AbortSignal,
  ): Promise<Response> {
    let body: FormData | string;
    if (typeof input === 'string')
      body = JSON.stringify({ generation: turn.generation, inputId, text: input });
    else {
      body = new FormData();
      body.append(
        'metadata',
        JSON.stringify({ generation: turn.generation, inputId, durationMs: input.durationMs }),
      );
      body.append('audio', input.blob, 'recording');
    }
    return this.request(`/api/sessions/${turn.sessionId}/turns/${turn.turnId}/input`, {
      method: 'POST',
      body,
      signal,
    });
  }
  async media(path: string, signal: AbortSignal): Promise<ArrayBuffer> {
    if (!/^\/api\/media\/[a-zA-Z0-9_-]+$/.test(path)) throw new Error('INVALID_MEDIA_PATH');
    const response = await this.request(path, { signal });
    if (!response.headers.get('content-type')?.startsWith('audio/'))
      throw new Error('INVALID_MEDIA_TYPE');
    const maximum = 8 * 1024 * 1024;
    if (Number(response.headers.get('content-length')) > maximum)
      throw new Error('MEDIA_TOO_LARGE');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('EMPTY_MEDIA');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        signal.throwIfAborted();
        size += result.value.byteLength;
        if (size > maximum) throw new Error('MEDIA_TOO_LARGE');
        chunks.push(result.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    if (!size) throw new Error('EMPTY_MEDIA');
    const buffer = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return buffer.buffer;
  }
  private requireSession(): SessionCreated {
    if (!this.session) throw new ApiError('SESSION_EXPIRED', '故事连接已结束，请重新开始。');
    return this.session;
  }
  private async json<T>(path: string, schema: Schema<T>, init: RequestInit): Promise<T> {
    const response = await this.request(path, init);
    return schema.parse(await response.json());
  }
  private async request(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    if (typeof init.body === 'string') headers.set('Content-Type', 'application/json');
    if (this.session) {
      headers.set('Authorization', `Bearer ${this.session.sessionToken}`);
      headers.set('X-Session-Id', this.session.sessionId);
    }
    const response = await this.fetcher(`${this.base}${path}`, {
      ...init,
      headers,
      cache: 'no-store',
    });
    if (!response.ok) {
      const error = HttpErrorSchema.safeParse(await response.json().catch(() => null));
      if (error.success)
        throw new ApiError(
          error.data.error.code,
          error.data.error.message,
          error.data.error.retryable,
        );
      throw new ApiError('NETWORK_ERROR', '连接暂时中断，请稍后再试。', true);
    }
    return response;
  }
}
