import { z } from 'zod';
import { IdSchema } from '@mira/protocol';
import { OutgoingMessagesSchema, type OutgoingMessage } from '../interaction/messages.js';

export const ReadingHistorySchema = z
  .array(
    z
      .object({
        id: z.number().int().positive(),
        kind: z.enum(['user', 'speech', 'narration', 'opening', 'image-share']),
        text: z.string().max(8000),
        source: z.enum(['opening', 'text', 'voice', 'sample', 'playback']).optional(),
        paused: z.boolean().default(false),
        messageId: IdSchema.optional(),
        shareId: IdSchema.optional(),
      })
      .strict(),
  )
  .max(60);
export type ReadingEntry = z.infer<typeof ReadingHistorySchema>[number];
const DocumentSchema = z
  .object({
    version: z.literal(1),
    epoch: IdSchema,
    history: ReadingHistorySchema,
    outgoing: OutgoingMessagesSchema,
  })
  .strict();
export type MessageDocument = z.infer<typeof DocumentSchema>;
export type MessageSnapshot = Pick<MessageDocument, 'history' | 'outgoing'>;
export interface MessageDatabase {
  update(
    scope: string,
    change: (current: unknown) => { document: MessageDocument; write: boolean } | undefined,
  ): Promise<MessageDocument | undefined>;
}

/** All read/modify/write work happens inside one native transaction, never across an await. */
export class IndexedMessageDatabase implements MessageDatabase {
  private opening?: Promise<IDBDatabase>;
  private retryAfter = 0;
  constructor(private readonly factory: () => IDBFactory = () => window.indexedDB) {}
  private open(): Promise<IDBDatabase> {
    if (Date.now() < this.retryAfter)
      return Promise.reject(new Error('MESSAGE_DATABASE_RETRY_LATER'));
    if (this.opening) return this.opening;
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.retryAfter = Date.now() + 5000;
        reject(error);
      };
      const timer = setTimeout(() => fail(new Error('MESSAGE_DATABASE_TIMEOUT')), 5000);
      try {
        const request = this.factory().open('character-platform-messages', 1);
        request.onupgradeneeded = () => {
          try {
            if (settled) {
              request.transaction?.abort();
              return;
            }
            if (!request.result.objectStoreNames.contains('conversations'))
              request.result.createObjectStore('conversations');
          } catch (error) {
            fail(error);
            try {
              request.transaction?.abort();
            } catch {
              /* The failed upgrade is already closed. */
            }
          }
        };
        request.onblocked = () => fail(new Error('MESSAGE_DATABASE_BLOCKED'));
        request.onerror = () => fail(request.error ?? new Error('MESSAGE_DATABASE_FAILED'));
        request.onsuccess = () => {
          if (settled) {
            request.result.close();
            return;
          }
          settled = true;
          clearTimeout(timer);
          this.retryAfter = 0;
          const database = request.result;
          database.onversionchange = () => {
            database.close();
            this.opening = undefined;
          };
          resolve(database);
        };
      } catch (error) {
        fail(error);
      }
    });
    this.opening = opening;
    void opening.catch(() => {
      if (this.opening === opening) this.opening = undefined;
    });
    return opening;
  }
  async update(scope: string, change: Parameters<MessageDatabase['update']>[1]) {
    const database = await this.open();
    return new Promise<MessageDocument | undefined>((resolve, reject) => {
      let result: MessageDocument | undefined;
      let failure: unknown;
      let transaction: IDBTransaction;
      try {
        transaction = database.transaction('conversations', 'readwrite');
      } catch (error) {
        this.opening = undefined;
        reject(error);
        return;
      }
      const timer = setTimeout(() => {
        failure = new Error('MESSAGE_TRANSACTION_TIMEOUT');
        this.retryAfter = Date.now() + 5000;
        this.opening = undefined;
        database.close();
        try {
          transaction.abort();
        } catch {
          reject(failure);
        }
      }, 10000);
      transaction.oncomplete = () => {
        clearTimeout(timer);
        resolve(result);
      };
      transaction.onabort = () => {
        clearTimeout(timer);
        reject(failure ?? transaction.error ?? new Error('MESSAGE_TRANSACTION_ABORTED'));
      };
      transaction.onerror = () => {
        failure ??= transaction.error;
      };
      const store = transaction.objectStore('conversations');
      const request = store.get(scope);
      request.onsuccess = () => {
        try {
          const update = change(request.result);
          result = update?.document;
          if (update?.write) store.put(update.document, scope);
        } catch (error) {
          failure = error;
          try {
            transaction.abort();
          } catch {
            clearTimeout(timer);
            reject(error);
          }
        }
      };
    });
  }
}

const database = new IndexedMessageDatabase();
export const defaultMessageDatabase = database;
export interface MessageStorageStatus {
  loading: boolean;
  error: string;
}
interface Options {
  database: MessageDatabase;
  scope: string;
  allowed(): boolean;
  legacy(): { snapshot: MessageSnapshot; committed(document: MessageDocument): boolean };
  expectedEpoch(): string | undefined;
  status(value: MessageStorageStatus): void;
}

/** Serializes writes, merges independent fields, and invalidates old work synchronously on reset. */
export class MessageRepository {
  private revision = 0;
  private memory: MessageDocument = {
    version: 1,
    epoch: crypto.randomUUID(),
    history: [],
    outgoing: [],
  };
  private ready?: Promise<void>;
  private tail: Promise<unknown> = Promise.resolve();
  private cleanup?: (document: MessageDocument) => boolean;
  private dirty: Partial<MessageSnapshot> = {};
  hydrated = false;
  private status: MessageStorageStatus = { loading: false, error: '' };
  constructor(private readonly options: Options) {}
  get epoch() {
    return this.memory.epoch;
  }
  private publish(value: Partial<MessageStorageStatus>) {
    const next = { ...this.status, ...value };
    if (next.loading === this.status.loading && next.error === this.status.error) return;
    this.status = next;
    this.options.status(this.status);
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(operation);
    this.tail = pending.catch(() => undefined);
    return pending;
  }
  private current(revision: number) {
    return this.revision === revision && this.options.allowed();
  }
  private failed(revision: number) {
    if (this.current(revision))
      this.publish({
        loading: false,
        error: '聊天记录暂时无法保存，当前页面仍可使用，刷新后可能丢失新内容。',
      });
  }
  private committed(document: MessageDocument, revision: number) {
    if (!this.current(revision)) return;
    this.memory = document;
    if (this.cleanup?.(document)) this.cleanup = undefined;
    this.publish({ error: '' });
  }
  async load(): Promise<MessageSnapshot> {
    if (!this.ready) {
      const revision = this.revision;
      const legacy = this.options.legacy();
      const expectedEpoch = this.options.expectedEpoch();
      this.memory = {
        ...this.memory,
        ...legacy.snapshot,
        ...(expectedEpoch ? { epoch: expectedEpoch } : {}),
      };
      this.cleanup = legacy.committed;
      this.publish({ loading: true });
      this.ready = this.enqueue(async () => {
        try {
          const result = await this.options.database.update(this.options.scope, (raw) => {
            if (!this.current(revision)) return undefined;
            const stored = raw === undefined ? this.memory : DocumentSchema.parse(raw);
            const reset = expectedEpoch && stored.epoch !== expectedEpoch;
            const document = reset
              ? { version: 1 as const, epoch: expectedEpoch, history: [], outgoing: [] }
              : stored;
            return { document, write: raw === undefined || !!reset };
          });
          if (result) this.committed(result, revision);
        } catch {
          this.failed(revision);
        } finally {
          if (revision === this.revision) {
            this.hydrated = true;
            this.publish({ loading: false });
          }
        }
      });
    }
    await this.ready;
    const { history, outgoing } = DocumentSchema.parse(this.memory);
    return { history, outgoing };
  }
  private patch(value: Partial<MessageSnapshot>): Promise<void> {
    const ready = this.load();
    const revision = this.revision;
    return this.enqueue(async () => {
      await ready;
      if (!this.current(revision)) return;
      const epoch = this.memory.epoch;
      const changes = { ...this.dirty, ...value };
      try {
        const result = await this.options.database.update(this.options.scope, (raw) => {
          if (!this.current(revision)) return undefined;
          const previous = raw === undefined ? this.memory : DocumentSchema.parse(raw);
          if (previous.epoch !== epoch) {
            if (this.options.expectedEpoch() !== epoch) return undefined;
            return { document: { ...this.memory, ...changes }, write: true };
          }
          return { document: { ...previous, ...changes }, write: true };
        });
        if (result) {
          if (this.current(revision)) this.dirty = {};
          this.committed(result, revision);
        } else if (this.current(revision))
          this.publish({ error: '聊天记录已在其他页面重置，请刷新后继续。' });
      } catch {
        if (this.current(revision)) {
          this.memory = { ...this.memory, ...value };
          this.dirty = changes;
        }
        this.failed(revision);
      }
    });
  }
  saveHistory(history: z.input<typeof ReadingHistorySchema>): Promise<void> {
    return this.patch({ history: ReadingHistorySchema.parse(history) });
  }
  saveOutgoing(outgoing: OutgoingMessage[]): Promise<void> {
    return this.patch({ outgoing: OutgoingMessagesSchema.parse(outgoing) });
  }
  clear(): Promise<void> {
    const revision = ++this.revision;
    const empty: MessageDocument = {
      version: 1,
      epoch: crypto.randomUUID(),
      history: [],
      outgoing: [],
    };
    this.memory = empty;
    this.cleanup = undefined;
    this.hydrated = false;
    this.dirty = {};
    this.publish({ loading: true });
    const pending = this.enqueue(async () => {
      try {
        const result = await this.options.database.update(this.options.scope, () =>
          this.current(revision) ? { document: empty, write: true } : undefined,
        );
        if (result) this.committed(result, revision);
      } catch {
        this.failed(revision);
      } finally {
        if (this.current(revision)) {
          this.hydrated = true;
          this.publish({ loading: false });
        }
      }
    });
    this.ready = pending;
    return pending;
  }
  async flush(): Promise<void> {
    await this.tail;
  }
}
