import { randomUUID } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import { CONNECTION_HEARTBEAT_MS, ConnectionEventSchema, SCHEMA_VERSION } from '@mira/protocol';

/** Process-local, bounded observers. This channel never accesses sessions or providers. */
export class ConnectionStreams {
  private streams = new Set<() => void>();
  private closing = false;
  constructor(private readonly capacity = 200) {}

  open(reply: FastifyReply): boolean {
    if (this.closing || this.streams.size >= this.capacity) return false;
    const response = reply.raw;
    const connectionId = randomUUID();
    let seq = 0;
    let closed = false;
    let blockedAt: number | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    const finish = () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      response.off('close', finish);
      response.off('error', finish);
      this.streams.delete(finish);
      if (!response.destroyed && !response.writableEnded) response.end();
    };
    this.streams.add(finish);
    response.once('close', finish);
    response.once('error', finish);
    const send = (type: 'connection.ready' | 'connection.heartbeat') => {
      if (closed) return;
      if (response.destroyed || response.writableEnded) {
        finish();
        return;
      }
      if (response.writableNeedDrain) {
        blockedAt ??= Date.now();
        if (Date.now() - blockedAt >= 15_000) finish();
        return;
      }
      blockedAt = undefined;
      const event = ConnectionEventSchema.parse({
        schemaVersion: SCHEMA_VERSION,
        type,
        connectionId,
        seq: ++seq,
        status: 'ready',
        heartbeatIntervalMs: CONNECTION_HEARTBEAT_MS,
      });
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    try {
      reply.hijack();
      for (const [name, value] of Object.entries(reply.getHeaders()))
        if (value !== undefined) response.setHeader(name, value);
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      response.flushHeaders();
      send('connection.ready');
      if (!closed)
        timer = setInterval(() => {
          try {
            send('connection.heartbeat');
          } catch {
            finish();
          }
        }, CONNECTION_HEARTBEAT_MS);
      timer?.unref();
    } catch {
      finish();
    }
    return true;
  }
  close(): void {
    this.closing = true;
    for (const finish of [...this.streams]) finish();
  }
}
