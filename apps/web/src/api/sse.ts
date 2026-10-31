/** Incremental SSE framing. A non-empty tail at EOF is a truncated response. */
export class SseParser {
  private decoder = new TextDecoder('utf-8', { fatal: true });
  private buffer = '';
  private data: string[] = [];
  private frameSize = 0;

  constructor(
    private readonly onData: (data: unknown) => void,
    private readonly maxBytes = 65_536,
  ) {}

  push(chunk: Uint8Array): void {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    this.drain(false);
    if (this.buffer.length + this.frameSize > this.maxBytes) throw new Error('SSE_BUFFER_LIMIT');
  }

  finish(): void {
    this.buffer += this.decoder.decode();
    this.drain(true);
    if (this.buffer.trim() || this.data.length) throw new Error('SSE_TRUNCATED');
  }

  private drain(final: boolean): void {
    for (;;) {
      const match = /\r\n|\r|\n/.exec(this.buffer);
      if (!match || (!final && match[0] === '\r' && match.index === this.buffer.length - 1)) return;
      const line = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      this.frameSize += line.length;
      if (this.frameSize > this.maxBytes) throw new Error('SSE_BUFFER_LIMIT');
      if (line === '') {
        if (this.data.length) this.onData(JSON.parse(this.data.join('\n')) as unknown);
        this.data = [];
        this.frameSize = 0;
      } else if (line.startsWith('data:')) {
        this.data.push(line.slice(5).replace(/^ /, ''));
      }
    }
  }
}

export async function readSse(
  body: ReadableStream<Uint8Array>,
  onData: (data: unknown) => void,
  signal: AbortSignal,
  idleMs = 30_000,
): Promise<void> {
  const reader = body.getReader();
  const parser = new SseParser(onData);
  const abort = () => {
    void reader.cancel(signal.reason);
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('SSE_IDLE_TIMEOUT')), idleMs);
      });
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await Promise.race([reader.read(), timeout]);
      } finally {
        clearTimeout(timer);
      }
      signal.throwIfAborted();
      if (result.done) {
        parser.finish();
        return;
      }
      parser.push(result.value);
    }
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
