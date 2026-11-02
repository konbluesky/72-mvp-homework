import { z } from 'zod';
import { OutgoingMessagesSchema } from '../interaction/messages.js';
import {
  MessageRepository,
  ReadingHistorySchema,
  defaultMessageDatabase,
  type MessageDatabase,
  type MessageStorageStatus,
} from './messages.js';
export { ReadingHistorySchema } from './messages.js';
export type { ReadingEntry } from './messages.js';
import {
  FrozenTurnSchema,
  IdSchema,
  ReceiptSchema,
  ReplySuggestionsSchema,
  SessionOpeningSchema,
  SessionExpirySchema,
} from '@mira/protocol';

export const BrowserPreferencesSchema = z
  .object({
    inputMode: z.enum(['text', 'voice']).default('text'),
    suggestionsExpanded: z.boolean().default(true),
    characterId: z.string().max(80).optional(),
  })
  .strict();
export const DraftSchema = z.string().max(16000);

const credentials = z
  .object({
    sessionId: IdSchema,
    sessionToken: z.string().min(32).max(256),
    expiresAt: SessionExpirySchema,
    mode: z.enum(['mock', 'live']),
  })
  .strict();
export type SessionCredentials = z.infer<typeof credentials>;
const activeRecovery = z
  .object({
    status: z.literal('active'),
    session: credentials,
    scenarioVersion: z.string().max(80),
    generation: z.number().int().nonnegative(),
    pendingRestart: z.boolean().optional(),
    messageEpoch: IdSchema.optional(),
    pending: z.array(ReceiptSchema).max(128),
    frozenTurns: z.array(FrozenTurnSchema).max(8),
    activeTurn: FrozenTurnSchema.optional(),
    outgoing: OutgoingMessagesSchema.optional(),
    presentation: z
      .object({
        revision: z.number().int().nonnegative(),
        suggestions: ReplySuggestionsSchema,
        opening: SessionOpeningSchema.nullable(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((value) => {
    const turns = [...value.frozenTurns, ...(value.activeTurn ? [value.activeTurn] : [])];
    return (
      new Set(turns.map((turn) => turn.turnId)).size === turns.length &&
      (value.outgoing ?? []).every(
        (message) =>
          message.turn.sessionId === value.session.sessionId &&
          message.turn.generation <= value.generation,
      ) &&
      turns.every(
        (turn) =>
          turn.generation <= value.generation &&
          turn.receipts.every(
            (receipt) =>
              receipt.sessionId === value.session.sessionId &&
              receipt.turnId === turn.turnId &&
              receipt.generation === turn.generation,
          ),
      ) &&
      value.pending.every(
        (receipt) =>
          receipt.sessionId === value.session.sessionId && receipt.generation <= value.generation,
      )
    );
  });
export type ActiveRecovery = z.infer<typeof activeRecovery>;
const recoverySchema = z.discriminatedUnion('status', [
  activeRecovery,
  z
    .object({
      status: z.literal('expired'),
      outgoing: OutgoingMessagesSchema.optional(),
      messageEpoch: IdSchema.optional(),
    })
    .strict(),
]);
export type BrowserRecovery = z.infer<typeof recoverySchema>;
const envelopeSchema = z
  .object({ version: z.literal(1), owner: z.string(), value: recoverySchema })
  .strict();

/** Small, versioned records. Browser data never supplies authoritative scene facts or URLs. */
export class BrowserPersistence {
  private readonly prefix: string;
  private readonly owner = crypto.randomUUID();
  private claimed = false;
  private readonly messages: MessageRepository;
  private messageStatus: MessageStorageStatus = { loading: false, error: '' };
  private statusListeners = new Set<(status: MessageStorageStatus) => void>();
  constructor(
    apiOrigin: string,
    entry: 'story' | 'conversation',
    readonly scenario: { id: string; version: string },
    private readonly storage: () => Storage = () => window.localStorage,
    database: MessageDatabase = defaultMessageDatabase,
  ) {
    this.prefix = `character-platform:v1:${encodeURIComponent(apiOrigin)}:${entry}:${encodeURIComponent(scenario.id)}:`;
    this.messages = new MessageRepository({
      database,
      scope: this.prefix,
      allowed: () => !this.claimed || this.ownsSession(),
      expectedEpoch: () => this.read('session', envelopeSchema)?.value.messageEpoch,
      legacy: () => {
        const historyRaw = this.raw('history');
        const history = this.parse('history', ReadingHistorySchema) ?? [];
        const outgoing = this.read('session', envelopeSchema)?.value.outgoing ?? [];
        return {
          snapshot: {
            history,
            outgoing,
          },
          committed: (document) => {
            if (!this.ownsSession()) return false;
            const historyCopied = history.every((line) =>
              document.history.some((saved) => JSON.stringify(saved) === JSON.stringify(line)),
            );
            if (historyRaw !== null && this.raw('history') === historyRaw && historyCopied)
              this.remove('history');
            const saved = this.read('session', envelopeSchema);
            const outgoingCopied = outgoing.every((message) =>
              document.outgoing.some(
                (stored) =>
                  stored.messageId === message.messageId &&
                  stored.turn.sessionId === message.turn.sessionId &&
                  stored.turn.generation >= message.turn.generation &&
                  JSON.stringify(stored.input) === JSON.stringify(message.input),
              ),
            );
            if (
              saved?.value.outgoing &&
              outgoingCopied &&
              JSON.stringify(saved.value.outgoing) === JSON.stringify(outgoing)
            ) {
              const { outgoing: _legacy, ...value } = saved.value;
              this.write('session', {
                ...saved,
                value: { ...value, messageEpoch: this.messages.epoch },
              });
            }
            return (
              this.raw('history') === null && !this.read('session', envelopeSchema)?.value.outgoing
            );
          },
        };
      },
      status: (status) => {
        this.messageStatus = status;
        for (const listener of this.statusListeners) listener(status);
      },
    });
  }
  private raw(name: string): string | null {
    try {
      return this.storage().getItem(this.prefix + name);
    } catch {
      return null;
    }
  }
  private parse<T>(name: string, schema: { parse(value: unknown): T }): T | undefined {
    try {
      const raw = this.raw(name);
      return raw && raw.length <= 512_000 ? schema.parse(JSON.parse(raw)) : undefined;
    } catch {
      return undefined;
    }
  }
  read<T>(
    name: 'draft' | 'preferences' | 'session',
    schema: { parse(value: unknown): T },
  ): T | undefined {
    return this.parse(name, schema);
  }
  private remove(name: string) {
    try {
      this.storage().removeItem(this.prefix + name);
    } catch {
      /* Keep the source on storage failure. */
    }
  }
  write(name: 'draft' | 'preferences' | 'session', value: unknown): void {
    if (name === 'draft' && this.claimed && !this.ownsSession()) return;
    try {
      const raw = JSON.stringify(value);
      if (raw.length <= 512_000) this.storage().setItem(this.prefix + name, raw);
    } catch {
      // Disabled storage and quota errors must not prevent a normal in-memory session.
    }
  }
  preferences() {
    return this.read('preferences', BrowserPreferencesSchema) ?? BrowserPreferencesSchema.parse({});
  }
  updatePreferences(value: Partial<z.infer<typeof BrowserPreferencesSchema>>) {
    this.write('preferences', { ...this.preferences(), ...value });
  }
  claimRecovery(): BrowserRecovery | undefined {
    const raw = this.raw('session');
    const saved = this.read('session', envelopeSchema);
    const value = saved?.value ?? (raw ? { status: 'expired' as const } : undefined);
    this.claimed = true;
    if (value) {
      this.write('session', { version: 1, owner: this.owner, value });
      // A full legacy localStorage must not prevent migration from freeing that space.
      if (this.read('session', envelopeSchema)?.owner !== this.owner) this.claimed = false;
    }
    return value;
  }
  ownsSession(): boolean {
    if (!this.claimed) return true;
    const saved = this.read('session', envelopeSchema);
    return !saved || saved.owner === this.owner;
  }
  saveRecovery(value: BrowserRecovery): void {
    if (!this.claimed || !this.ownsSession()) return;
    const { outgoing, ...metadata } = value;
    if (outgoing && this.messages.hydrated) void this.messages.saveOutgoing(outgoing);
    // Retain a pre-upgrade source until the IndexedDB transaction has committed.
    const legacy = this.read('session', envelopeSchema)?.value.outgoing;
    const messageEpoch = this.messages.hydrated
      ? this.messages.epoch
      : (metadata.messageEpoch ?? this.read('session', envelopeSchema)?.value.messageEpoch);
    this.write('session', {
      version: 1,
      owner: this.owner,
      value: {
        ...metadata,
        ...(messageEpoch ? { messageEpoch } : {}),
        ...(legacy ? { outgoing: legacy } : {}),
      },
    });
  }
  loadMessages() {
    if (!this.claimed) this.claimRecovery();
    return this.messages.load();
  }
  saveHistory(history: z.input<typeof ReadingHistorySchema>) {
    if (!this.claimed) this.claimRecovery();
    return this.messages.saveHistory(history);
  }
  flushMessages() {
    return this.messages.flush();
  }
  onMessageStatus(listener: (status: MessageStorageStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.messageStatus);
    return () => this.statusListeners.delete(listener);
  }
  onReplacement(callback: () => void): () => void {
    const listener = (event: StorageEvent) => {
      if (event.key === this.prefix + 'session' && this.claimed && !this.ownsSession()) callback();
    };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
  }
  clearReading(): Promise<void> {
    this.claimRecovery();
    this.write('draft', '');
    this.remove('history');
    const clearing = this.messages.clear();
    const saved = this.read('session', envelopeSchema);
    if (saved) {
      const { outgoing: _legacy, ...value } = saved.value;
      this.write('session', { ...saved, value: { ...value, messageEpoch: this.messages.epoch } });
    } else
      this.write('session', {
        version: 1,
        owner: this.owner,
        value: { status: 'expired', messageEpoch: this.messages.epoch },
      });
    return clearing;
  }
}
