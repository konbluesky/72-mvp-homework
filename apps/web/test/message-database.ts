import type { MessageDatabase, MessageDocument } from '../src/persistence/messages.js';

const copy = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
export const legacyRecordKey = (origin: string, entry: string, scenario: string, name: string) =>
  `character-platform:v1:${encodeURIComponent(origin)}:${entry}:${encodeURIComponent(scenario)}:${name}`;

/** Controlled transaction boundary for race tests; no runtime storage fallback uses this. */
export class MemoryMessageDatabase implements MessageDatabase {
  private records = new Map<string, MessageDocument>();
  private tail: Promise<unknown> = Promise.resolve();
  private barrier?: { begin(): void; wait: Promise<void> };
  failCommit = false;
  holdNext() {
    let release!: () => void;
    let begin!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      begin = resolve;
    });
    this.barrier = { begin, wait };
    return { release, started };
  }
  update(scope: string, change: Parameters<MessageDatabase['update']>[1]) {
    const operation = this.tail.then(async () => {
      const barrier = this.barrier;
      this.barrier = undefined;
      if (barrier) {
        barrier.begin();
        await barrier.wait;
      }
      const result = change(copy(this.records.get(scope)));
      if (this.failCommit) {
        this.failCommit = false;
        throw new Error('QuotaExceededError');
      }
      if (result?.write) this.records.set(scope, copy(result.document));
      return copy(result?.document);
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }
}
