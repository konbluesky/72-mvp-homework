import { ConnectionEventSchema, CONNECTION_IDLE_MS, type ConnectionProbe } from '@mira/protocol';
import { readSse } from '../api/sse.js';
import { abortable } from '../playback/abortable.js';

export type ConnectionState =
  'connecting' | 'connected' | 'degraded' | 'reconnecting' | 'offline' | 'suspended';
export interface ConnectionView {
  state: ConnectionState;
  streamConnected: boolean;
  latencyMs: number | null;
  lastEventAt: number | null;
  lastProbeAt: number | null;
  reconnectAttempt: number;
  lastError: string | null;
}
export const initialConnectionView = (): ConnectionView => ({
  state: 'connecting',
  streamConnected: false,
  latencyMs: null,
  lastEventAt: null,
  lastProbeAt: null,
  reconnectAttempt: 0,
  lastError: null,
});
export interface ConnectionPort {
  connectionEvents(signal: AbortSignal): Promise<Response>;
  probeConnection(signal: AbortSignal): Promise<ConnectionProbe>;
}
interface Options {
  view(value: ConnectionView): void;
  reachable(): void;
  unavailable(): void;
  now?: () => number;
  wallNow?: () => number;
  random?: () => number;
}

/** Independent of framework, session and turn. It never retries business POSTs. */
export class ConnectionMonitor {
  private value = initialConnectionView();
  private epoch = 0;
  private lifetime?: AbortController;
  private streamTimer?: ReturnType<typeof setTimeout>;
  private probeTimer?: ReturnType<typeof setTimeout>;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private streamOpen = false;
  private probeHealthy = false;
  private httpResponding = false;
  private failures = 0;
  private notifiedUnavailable = false;
  private disposed = false;
  private now: () => number;
  private wallNow: () => number;
  private random: () => number;
  constructor(
    private readonly port: ConnectionPort,
    private readonly options: Options,
  ) {
    this.now = options.now ?? (() => performance.now());
    this.wallNow = options.wallNow ?? Date.now;
    this.random = options.random ?? Math.random;
  }
  start(): void {
    if (this.disposed || this.lifetime) return;
    const epoch = ++this.epoch;
    this.lifetime = new AbortController();
    this.streamOpen = false;
    this.probeHealthy = false;
    this.failures = 0;
    this.httpResponding = false;
    this.notifiedUnavailable = false;
    this.value.reconnectAttempt = 0;
    this.publish({ state: 'connecting', latencyMs: null, lastError: null });
    void this.open(epoch);
    void this.probe(epoch);
  }
  retry(): void {
    if (this.disposed) return;
    this.stop();
    this.start();
  }
  suspend(): void {
    if (this.disposed) return;
    this.stop();
    this.publish({ state: 'suspended', latencyMs: null });
  }
  offline(): void {
    if (this.disposed) return;
    this.stop();
    this.publish({ state: 'offline', latencyMs: null, lastError: '浏览器网络已断开' });
    this.notifiedUnavailable = false; // An explicit browser outage also cancels any newly restored work.
    this.notifyUnavailable();
  }
  dispose(): void {
    this.disposed = true;
    this.stop();
  }
  private stop(): void {
    ++this.epoch;
    this.lifetime?.abort();
    this.lifetime = undefined;
    this.clearTimer(this.streamTimer);
    this.clearTimer(this.probeTimer);
    this.streamTimer = this.probeTimer = undefined;
    for (const timer of [...this.timers]) this.clearTimer(timer);
    this.streamOpen = false;
    this.probeHealthy = false;
  }
  private later(callback: () => void, ms: number): ReturnType<typeof setTimeout> {
    const id = setTimeout(() => {
      this.timers.delete(id);
      callback();
    }, ms);
    this.timers.add(id);
    return id;
  }
  private clearTimer(id: ReturnType<typeof setTimeout> | undefined): void {
    if (id === undefined) return;
    clearTimeout(id);
    this.timers.delete(id);
  }
  private current(epoch: number): boolean {
    return (
      !this.disposed && epoch === this.epoch && !!this.lifetime && !this.lifetime.signal.aborted
    );
  }
  private publish(value: Partial<ConnectionView>) {
    Object.assign(this.value, value, { streamConnected: this.streamOpen });
    this.options.view({ ...this.value });
  }
  private notifyUnavailable() {
    if (this.notifiedUnavailable) return;
    this.notifiedUnavailable = true;
    this.options.unavailable();
  }
  private async open(epoch: number): Promise<void> {
    if (!this.current(epoch)) return;
    const attempt = new AbortController();
    const signal = AbortSignal.any([this.lifetime!.signal, attempt.signal]);
    const readyTimeout = this.later(
      () => attempt.abort(new Error('CONNECTION_READY_TIMEOUT')),
      5_000,
    );
    let connectionId = '',
      seq = 0;
    let heartbeatTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      signal.throwIfAborted();
      const pending = this.port.connectionEvents(signal);
      void pending.then(
        (response) => {
          if (signal.aborted) void response.body?.cancel().catch(() => undefined);
        },
        () => undefined,
      );
      const response = await abortable(pending, signal);
      if (!this.current(epoch)) {
        void response.body?.cancel();
        return;
      }
      if (
        !response.ok ||
        !response.headers.get('content-type')?.startsWith('text/event-stream') ||
        !response.body
      )
        throw new Error('INVALID_CONNECTION_STREAM');
      const reading = readSse(
        response.body,
        (data) => {
          if (!this.current(epoch) || signal.aborted) return;
          const event = ConnectionEventSchema.parse(data);
          if (
            event.seq !== seq + 1 ||
            (seq === 0
              ? event.type !== 'connection.ready'
              : event.type !== 'connection.heartbeat') ||
            (connectionId && event.connectionId !== connectionId)
          )
            throw new Error('CONNECTION_SEQUENCE');
          connectionId = event.connectionId;
          seq = event.seq;
          this.clearTimer(readyTimeout);
          this.clearTimer(heartbeatTimeout);
          heartbeatTimeout = this.later(
            () => attempt.abort(new Error('CONNECTION_HEARTBEAT_TIMEOUT')),
            CONNECTION_IDLE_MS,
          );
          this.streamOpen = true;
          this.publish({
            state: this.probeHealthy ? 'connected' : 'degraded',
            lastEventAt: this.wallNow(),
            reconnectAttempt: 0,
            lastError: this.probeHealthy ? null : this.value.lastError,
          });
        },
        signal,
        CONNECTION_IDLE_MS,
      );
      await abortable(reading, signal);
      throw new Error('CONNECTION_STREAM_ENDED');
    } catch {
      if (!this.current(epoch)) return;
      this.streamOpen = false;
      const retry = Math.min(this.value.reconnectAttempt + 1, 32);
      this.publish({
        state: this.httpResponding ? 'degraded' : this.failures >= 2 ? 'offline' : 'reconnecting',
        reconnectAttempt: retry,
        lastError: 'SSE 监测流中断，正在重连',
      });
      if (!this.probeHealthy && this.failures >= 2) this.notifyUnavailable();
      const delay = Math.min(
        30_000,
        1_000 * 2 ** Math.min(retry - 1, 5) * (0.8 + this.random() * 0.4),
      );
      this.streamTimer = this.later(() => {
        void this.open(epoch);
      }, delay);
    } finally {
      this.clearTimer(readyTimeout);
      this.clearTimer(heartbeatTimeout);
      attempt.abort();
    }
  }
  private async probe(epoch: number): Promise<void> {
    if (!this.current(epoch)) return;
    const deadline = new AbortController();
    const signal = AbortSignal.any([this.lifetime!.signal, deadline.signal]);
    const timer = this.later(() => deadline.abort(new Error('CONNECTION_PROBE_TIMEOUT')), 3_000);
    const start = this.now();
    try {
      signal.throwIfAborted();
      const pending = this.port.probeConnection(signal);
      void pending.catch(() => undefined);
      await abortable(pending, signal);
      if (!this.current(epoch) || signal.aborted) return;
      this.probeHealthy = true;
      this.httpResponding = true;
      this.failures = 0;
      this.notifiedUnavailable = false;
      this.publish({
        state: this.streamOpen
          ? 'connected'
          : this.value.reconnectAttempt
            ? 'degraded'
            : 'connecting',
        latencyMs: Math.max(0, Math.round(this.now() - start)),
        lastProbeAt: this.wallNow(),
        lastError: this.streamOpen ? null : this.value.lastError,
      });
      this.options.reachable();
    } catch (error) {
      if (!this.current(epoch)) return;
      this.probeHealthy = false;
      const status =
        error &&
        typeof error === 'object' &&
        'httpStatus' in error &&
        typeof error.httpStatus === 'number'
          ? error.httpStatus
          : undefined;
      // A rejected/unsupported monitor is not proof that the whole API is offline.
      this.httpResponding =
        status !== undefined && status < 500 && status !== 408 && status !== 429;
      this.failures = this.httpResponding ? 0 : this.failures + 1;
      this.publish({
        state:
          this.streamOpen || this.httpResponding
            ? 'degraded'
            : this.failures >= 2
              ? 'offline'
              : 'reconnecting',
        latencyMs: null,
        lastError:
          status === undefined
            ? '往返探测超时或不可达'
            : status === 200
              ? '监测响应格式异常（HTTP 200）'
              : `往返探测返回 HTTP ${status}`,
      });
      if (this.httpResponding) {
        this.notifiedUnavailable = false;
        this.options.reachable();
      }
      if (this.failures >= 2 && !this.streamOpen) this.notifyUnavailable();
    } finally {
      this.clearTimer(timer);
      if (this.current(epoch))
        this.probeTimer = this.later(() => {
          void this.probe(epoch);
        }, 5_000);
    }
  }
}
