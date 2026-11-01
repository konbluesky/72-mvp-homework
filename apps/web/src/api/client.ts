import { abortable } from '../playback/abortable.js';
import {
  BeginTurnResponseSchema,
  ConnectionProbeSchema,
  HttpErrorSchema,
  ReceiptsResponseSchema,
  SessionCreatedSchema,
  SessionSnapshotSchema,
  TranscriptionPreviewSchema,
  type FrozenTurn,
  type StoryInteraction,
  type Receipt,
  type SessionCreated,
  type TurnIdentity,
} from '@mira/protocol';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly httpStatus?: number,
    readonly requestId?: string,
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
    private readonly sessionEntry: 'story' | 'conversation' = 'story',
    private readonly expectedScenario?: { id: string; version: string },
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
      body: JSON.stringify({ entry: this.sessionEntry }),
      signal,
    });
    signal?.throwIfAborted();
    this.validateScenario(session.scene);
    this.session = session;
    return session;
  }
  connectionEvents(signal: AbortSignal): Promise<Response> {
    return this.request(
      '/api/connection/events',
      { signal, headers: { Accept: 'text/event-stream' } },
      false,
    );
  }
  probeConnection(signal: AbortSignal) {
    return this.json('/api/connection/ping', ConnectionProbeSchema, { signal }, false);
  }
  clear(): void {
    this.session = undefined;
  }
  snapshot(signal?: AbortSignal) {
    return this.json(`/api/sessions/${this.requireSession().sessionId}`, SessionSnapshotSchema, {
      signal,
    }).then((snapshot) => {
      this.validateScenario(snapshot.scene);
      return snapshot;
    });
  }
  private validateScenario(scene: { scenario?: { id: string; version: string } }) {
    if (
      this.expectedScenario &&
      (scene.scenario?.id !== this.expectedScenario.id ||
        scene.scenario.version !== this.expectedScenario.version)
    )
      throw new ApiError(
        'SCENE_MODULE_VERSION_MISMATCH',
        '场景版本与服务端不一致，请刷新页面后重试。',
      );
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
        signal: AbortSignal.timeout(10_000),
      },
    );
    await response.arrayBuffer();
  }
  receipts(receipts: Receipt[], signal?: AbortSignal) {
    return this.json(
      `/api/sessions/${this.requireSession().sessionId}/receipts`,
      ReceiptsResponseSchema,
      { method: 'POST', body: JSON.stringify({ receipts }), signal },
    );
  }
  input(
    turn: TurnIdentity,
    input: string | { blob: Blob; durationMs: number } | { interaction: StoryInteraction },
    inputId: string,
    signal: AbortSignal,
  ): Promise<Response> {
    let body: FormData | string;
    if (typeof input === 'string')
      body = JSON.stringify({ generation: turn.generation, inputId, text: input });
    else if ('interaction' in input)
      body = JSON.stringify({
        generation: turn.generation,
        inputId,
        interaction: input.interaction,
      });
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
  transcribe(
    turn: TurnIdentity,
    input: { blob: Blob; durationMs: number },
    inputId: string,
    signal: AbortSignal,
  ) {
    const body = new FormData();
    body.append(
      'metadata',
      JSON.stringify({ generation: turn.generation, inputId, durationMs: input.durationMs }),
    );
    body.append('audio', input.blob, 'recording');
    return this.json(
      `/api/sessions/${turn.sessionId}/turns/${turn.turnId}/transcription`,
      TranscriptionPreviewSchema,
      {
        method: 'POST',
        body,
        signal,
      },
      true,
      120_000, // Upload + decode + STT have their own server budgets; not a 10s control request.
    );
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
  private async json<T>(
    path: string,
    schema: Schema<T>,
    init: RequestInit,
    authenticated = true,
    timeoutMs = 10_000,
  ): Promise<T> {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(new Error('REQUEST_TIMEOUT')), timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, deadline.signal]) : deadline.signal;
    let httpStatus: number | undefined;
    try {
      signal.throwIfAborted();
      const operation = this.request(path, { ...init, signal }, authenticated).then(
        async (response) => {
          httpStatus = response.status;
          const value: unknown = await response.json();
          signal.throwIfAborted();
          try {
            return schema.parse(value);
          } catch {
            throw new ApiError(
              'INVALID_RESPONSE',
              '服务响应格式异常，请检查连接或代理配置。',
              false,
              response.status,
            );
          }
        },
      );
      return await abortable(operation, signal);
    } catch (error) {
      if (init.signal?.aborted) throw error;
      if (deadline.signal.aborted)
        throw new ApiError('REQUEST_TIMEOUT', '请求超时，请稍后重试。', true);
      if (error instanceof SyntaxError)
        throw new ApiError(
          'INVALID_RESPONSE',
          '服务响应格式异常，请检查连接或代理配置。',
          false,
          httpStatus,
        );
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  private async request(path: string, init: RequestInit, authenticated = true): Promise<Response> {
    init.signal?.throwIfAborted();
    const headers = new Headers(init.headers);
    if (typeof init.body === 'string') headers.set('Content-Type', 'application/json');
    if (authenticated && this.session) {
      headers.set('Authorization', `Bearer ${this.session.sessionToken}`);
      headers.set('X-Session-Id', this.session.sessionId);
    }
    let response: Response;
    try {
      response = await this.fetcher(`${this.base}${path}`, {
        ...init,
        credentials: authenticated ? (init.credentials ?? 'same-origin') : 'omit',
        headers,
        cache: 'no-store',
      });
    } catch (error) {
      if (init.signal?.aborted) throw error;
      throw new ApiError('NETWORK_UNAVAILABLE', '暂时无法连接服务，正在检测网络。', true);
    }
    if (init.signal?.aborted) {
      void response.body?.cancel().catch(() => undefined);
      init.signal.throwIfAborted();
    }
    if (!response.ok) {
      const error = HttpErrorSchema.safeParse(await response.json().catch(() => null));
      init.signal?.throwIfAborted();
      if (error.success)
        throw new ApiError(
          error.data.error.code,
          error.data.error.message,
          error.data.error.retryable,
          response.status,
          error.data.requestId,
        );
      const code =
        response.status === 401
          ? 'UNAUTHORIZED'
          : response.status === 410
            ? 'SESSION_EXPIRED'
            : 'HTTP_ERROR';
      throw new ApiError(
        code,
        `服务请求失败（HTTP ${response.status}），请稍后重试。`,
        response.status >= 500 || response.status === 429,
        response.status,
      );
    }
    return response;
  }
}
