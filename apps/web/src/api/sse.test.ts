import { describe, expect, it } from 'vitest';
import { readSse, SseParser } from './sse.js';

describe('SSE framing', () => {
  it('handles byte-split UTF-8, CRLF, comments and multiline JSON', () => {
    const values: unknown[] = [];
    const parser = new SseParser((value) => values.push(value));
    const bytes = new TextEncoder().encode(
      ': pulse\r\ndata: {"text":\r\ndata: "你好，Mira"}\r\n\r\n',
    );
    for (const byte of bytes) parser.push(new Uint8Array([byte]));
    parser.finish();
    expect(values).toEqual([{ text: '你好，Mira' }]);
  });
  it('rejects incomplete trailing frames, malformed JSON and unbounded frames', () => {
    const parser = new SseParser(() => undefined);
    parser.push(new TextEncoder().encode('data: {"a":1}\n'));
    expect(() => parser.finish()).toThrow('SSE_TRUNCATED');
    expect(() =>
      new SseParser(() => undefined).push(new TextEncoder().encode('data: invalid\n\n')),
    ).toThrow();
    expect(() =>
      new SseParser(() => undefined, 8).push(new TextEncoder().encode('data: 123456789')),
    ).toThrow('SSE_BUFFER_LIMIT');
  });
  it('cancels and releases the reader when callback validation fails', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {}\n\n'));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      readSse(
        body,
        () => {
          throw new Error('SCHEMA');
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('SCHEMA');
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  });
});
