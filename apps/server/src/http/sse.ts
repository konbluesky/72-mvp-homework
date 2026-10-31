import { randomUUID } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import { SCHEMA_VERSION, ServerEventSchema } from '@mira/protocol';
import type { Publish } from '../graphs/conversation.js';
import type { Session, SessionManager, Turn } from '../sessions/manager.js';
import { AppError, publicError } from './errors.js';

export async function openStream(
  reply: FastifyReply,
  sessions: SessionManager,
  session: Session,
  turn: Turn,
  heartbeatMs: number,
) {
  const response = reply.raw;
  const streamId = randomUUID();
  turn.streamId = streamId;
  reply.hijack();
  for (const [name, value] of Object.entries(reply.getHeaders()))
    if (value !== undefined) response.setHeader(name, value);
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  let seq = 0;
  let ended = false;
  const owned = () => turn.streamId === streamId;
  const close = () => {
    if (!ended && !response.writableFinished && owned()) {
      sessions.fail(
        turn,
        new AppError('STREAM_INTERRUPTED', 499, '连接暂时断开，请重新开始。', true),
      );
    }
  };
  response.once('close', close);
  const write = async (frame: string) => {
    if (response.destroyed || response.writableEnded)
      throw new AppError('STREAM_INTERRUPTED', 499, '连接暂时断开，请重新开始。', true);
    if (response.write(frame)) return;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        response.off('drain', drain);
        response.off('close', disconnected);
        turn.abort.signal.removeEventListener('abort', aborted);
      };
      const drain = () => {
        cleanup();
        resolve();
      };
      const disconnected = () => {
        cleanup();
        reject(new AppError('STREAM_INTERRUPTED', 499, '连接暂时断开，请重新开始。', true));
      };
      const aborted = () => {
        cleanup();
        reject(turn.abort.signal.reason);
      };
      response.once('drain', drain);
      response.once('close', disconnected);
      turn.abort.signal.addEventListener('abort', aborted, { once: true });
      if (turn.abort.signal.aborted) aborted();
    });
  };
  const publish: Publish = async (content) => {
    sessions.assertCurrent(session, turn);
    if (!owned()) throw new AppError('STREAM_INTERRUPTED', 499, '连接暂时断开，请重新开始。', true);
    const event = ServerEventSchema.parse({
      ...turn.identity,
      schemaVersion: SCHEMA_VERSION,
      eventId: randomUUID(),
      seq: ++seq,
      ...content,
    });
    await write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const heartbeat = setInterval(() => {
    if (!response.destroyed && !response.writableEnded && !response.writableNeedDrain)
      response.write(': heartbeat\n\n');
  }, heartbeatMs);
  heartbeat.unref();
  const finish = () => {
    ended = true;
    clearInterval(heartbeat);
    response.off('close', close);
    if (!response.destroyed && !response.writableEnded) response.end();
    if (owned()) turn.streamId = undefined;
  };
  try {
    await publish({
      type: 'ready',
      payload: { streamId, remainingLifetimeMs: sessions.remainingLifetime(turn) },
    });
  } catch (error) {
    finish();
    throw error;
  }
  return {
    publish,
    async error(error: unknown) {
      const safe = publicError(error);
      if (!response.destroyed && !response.writableEnded && owned()) {
        const event = ServerEventSchema.parse({
          ...turn.identity,
          schemaVersion: SCHEMA_VERSION,
          eventId: randomUUID(),
          seq: ++seq,
          type: 'error',
          payload: { code: safe.code, message: safe.message, retryable: safe.retryable },
        });
        response.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    },
    finish,
  };
}
