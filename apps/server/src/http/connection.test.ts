import { EventEmitter } from 'node:events';
import type { FastifyReply } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONNECTION_HEARTBEAT_MS, ConnectionEventSchema } from '@mira/protocol';
import { ConnectionStreams } from './connection.js';

class ResponseStub extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  writableNeedDrain = false;
  frames: string[] = [];
  setHeader() {}
  writeHead() {}
  flushHeaders() {}
  write(frame: string) {
    this.frames.push(frame);
    return true;
  }
  end() {
    this.writableEnded = true;
    this.emit('close');
  }
}
const reply = (raw: ResponseStub) =>
  ({ raw, hijack() {}, getHeaders: () => ({}) }) as unknown as FastifyReply;
const frame = (raw: ResponseStub, index: number) =>
  ConnectionEventSchema.parse(JSON.parse(raw.frames[index]!.slice(6)));
afterEach(() => vi.useRealTimers());
describe('stateless SSE observer lifetime', () => {
  it('bounds capacity and frees it on close without a session or provider', () => {
    vi.useFakeTimers();
    const service = new ConnectionStreams(1);
    const a = new ResponseStub(),
      b = new ResponseStub();
    expect(service.open(reply(a))).toBe(true);
    expect(service.open(reply(b))).toBe(false);
    expect(frame(a, 0)).toMatchObject({ seq: 1, type: 'connection.ready' });
    a.emit('close');
    expect(service.open(reply(b))).toBe(true);
    a.emit('close');
    expect(service.open(reply(new ResponseStub()))).toBe(false);
    service.close();
    expect(b.writableEnded).toBe(true);
    expect(service.open(reply(new ResponseStub()))).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not queue heartbeats under backpressure or create sequence gaps', () => {
    vi.useFakeTimers();
    const service = new ConnectionStreams();
    const response = new ResponseStub();
    service.open(reply(response));
    response.writableNeedDrain = true;
    vi.advanceTimersByTime(CONNECTION_HEARTBEAT_MS * 3);
    expect(response.frames).toHaveLength(1);
    response.writableNeedDrain = false;
    vi.advanceTimersByTime(CONNECTION_HEARTBEAT_MS);
    expect(frame(response, 1)).toMatchObject({
      seq: 2,
      type: 'connection.heartbeat',
      connectionId: frame(response, 0).connectionId,
    });
    service.close();
  });
  it('cannot install an orphan timer if the response closes during the first frame', () => {
    vi.useFakeTimers();
    const service = new ConnectionStreams(1);
    const response = new ResponseStub();
    response.write = () => {
      response.emit('close');
      return false;
    };
    service.open(reply(response));
    expect(vi.getTimerCount()).toBe(0);
    expect(service.open(reply(new ResponseStub()))).toBe(true);
    service.close();
  });
});
