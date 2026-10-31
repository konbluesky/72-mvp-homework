import { describe, expect, it } from 'vitest';
import { abortable } from './abortable.js';
describe('non-cancellable async boundaries', () => {
  it('releases the awaiting owner on abort while safely ignoring late completion', async () => {
    let finish!: (value: number) => void;
    const upstream = new Promise<number>((resolve) => {
      finish = resolve;
    });
    const controller = new AbortController();
    const awaiting = abortable(upstream, controller.signal);
    controller.abort(new Error('REPLACED'));
    await expect(awaiting).rejects.toThrow('REPLACED');
    finish(42);
    await Promise.resolve();
    await expect(awaiting).rejects.toThrow('REPLACED');
  });
  it('removes abort ownership after successful preparation', async () => {
    const controller = new AbortController();
    const prepared = abortable(Promise.resolve('ready'), controller.signal);
    await expect(prepared).resolves.toBe('ready');
    controller.abort();
    await expect(prepared).resolves.toBe('ready');
  });
});
