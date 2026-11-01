import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProbe } from '@mira/protocol';
import { ConnectionMonitor, type ConnectionPort, type ConnectionView } from './monitor.js';

const tick = async () => {
  for (let i = 0; i < 16; i++) await Promise.resolve();
};
const probe: ConnectionProbe = { schemaVersion: 3, status: 'ok' };
function fixture() {
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const views: ConnectionView[] = [];
  const events = vi.fn<ConnectionPort['connectionEvents']>(async (signal) => {
    const id = `connection-${streams.length}`;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        streams.push(controller);
        signal.addEventListener(
          'abort',
          () => {
            try {
              controller.error(signal.reason);
            } catch {
              /* already cancelled */
            }
          },
          { once: true },
        );
        controller.enqueue(
          new TextEncoder().encode(
            `data: ${JSON.stringify({
              schemaVersion: 3,
              type: 'connection.ready',
              connectionId: id,
              seq: 1,
              status: 'ready',
              heartbeatIntervalMs: 5000,
            })}\n\n`,
          ),
        );
      },
    });
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const ping = vi.fn<ConnectionPort['probeConnection']>().mockResolvedValue(probe);
  const reachable = vi.fn(),
    unavailable = vi.fn();
  const monitor = new ConnectionMonitor(
    { connectionEvents: events, probeConnection: ping },
    {
      view: (view) => views.push(view),
      reachable,
      unavailable,
      random: () => 0.5,
    },
  );
  return {
    monitor,
    streams,
    views,
    events,
    ping,
    reachable,
    unavailable,
    latest: () => views.at(-1)!,
  };
}
afterEach(() => vi.useRealTimers());
describe('SSE health ownership and reconnect', () => {
  it('reconnects a closed health stream without business requests or an unavailable notification', async () => {
    vi.useFakeTimers();
    const h = fixture();
    h.monitor.start();
    await tick();
    expect(h.latest().state).toBe('connected');
    h.streams[0]!.close();
    await tick();
    expect(h.latest().state).toBe('degraded');
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.events).toHaveBeenCalledTimes(2);
    expect(h.latest().state).toBe('connected');
    expect(h.unavailable).not.toHaveBeenCalled();
    h.monitor.dispose();
    await tick();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('ignores an old non-cooperative probe that settles after retry', async () => {
    vi.useFakeTimers();
    const h = fixture();
    let complete!: (value: ConnectionProbe) => void;
    h.ping.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    h.monitor.start();
    await tick();
    h.monitor.retry();
    await tick();
    expect(h.latest().state).toBe('connected');
    const count = h.views.length;
    complete(probe);
    await tick();
    expect(h.views).toHaveLength(count);
    h.monitor.dispose();
    await tick();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('treats comment bytes as insufficient when typed heartbeats have stopped', async () => {
    vi.useFakeTimers();
    const h = fixture();
    h.monitor.start();
    await tick();
    for (let i = 0; i < 2; i++) {
      await vi.advanceTimersByTimeAsync(5000);
      h.streams[0]!.enqueue(new TextEncoder().encode(': not-a-typed-heartbeat\n\n'));
      await tick();
    }
    await vi.advanceTimersByTimeAsync(5100);
    expect(h.latest().state).toBe('degraded');
    expect(h.unavailable).not.toHaveBeenCalled();
    h.monitor.dispose();
    await tick();
  });
  it('declares unreachable only after repeated HTTP failures and no live SSE', async () => {
    vi.useFakeTimers();
    const h = fixture();
    h.events.mockRejectedValue(new Error('NETWORK'));
    h.ping.mockRejectedValue(new Error('NETWORK'));
    h.monitor.start();
    await tick();
    expect(h.unavailable).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5500);
    expect(h.latest().state).toBe('offline');
    expect(h.latest().latencyMs).toBeNull();
    expect(h.unavailable).toHaveBeenCalledOnce();
    h.monitor.dispose();
    await tick();
  });
  it('does not label a reachable API offline when the monitoring endpoint is unsupported', async () => {
    vi.useFakeTimers();
    const h = fixture();
    h.events.mockRejectedValue(new Error('UNSUPPORTED'));
    h.ping.mockRejectedValue(Object.assign(new Error('UNSUPPORTED'), { httpStatus: 404 }));
    h.monitor.start();
    await tick();
    await vi.advanceTimersByTimeAsync(16000);
    expect(h.latest().state).toBe('degraded');
    expect(h.latest().lastError).toBeTruthy();
    expect(h.unavailable).not.toHaveBeenCalled();
    h.monitor.dispose();
    await tick();
  });
  it('suspends all probes and ignores a stale stream before starting a fresh lifetime', async () => {
    vi.useFakeTimers();
    const h = fixture();
    h.monitor.start();
    await tick();
    h.monitor.suspend();
    await tick();
    const attempts = h.events.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(h.events).toHaveBeenCalledTimes(attempts);
    expect(h.latest().state).toBe('suspended');
    h.monitor.start();
    await tick();
    expect(h.latest().state).toBe('connected');
    h.monitor.dispose();
    await tick();
    expect(vi.getTimerCount()).toBe(0);
  });
});
