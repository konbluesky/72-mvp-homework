import { z } from 'zod';
import { OutgoingMessagesSchema } from '../interaction/messages.js';
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
export const ReadingHistorySchema = z
  .array(
    z
      .object({
        id: z.number().int().positive(),
        kind: z.enum(['user', 'speech', 'narration', 'opening']),
        text: z.string().max(8000),
        source: z.enum(['opening', 'text', 'voice', 'sample', 'playback']).optional(),
        paused: z.boolean().default(false),
        messageId: IdSchema.optional(),
      })
      .strict(),
  )
  .max(60);
export type ReadingEntry = z.infer<typeof ReadingHistorySchema>[number];
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
  z.object({ status: z.literal('expired'), outgoing: OutgoingMessagesSchema.optional() }).strict(),
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
  constructor(
    apiOrigin: string,
    entry: 'story' | 'conversation',
    readonly scenario: { id: string; version: string },
    private readonly storage: () => Storage = () => window.localStorage,
  ) {
    this.prefix = `character-platform:v1:${encodeURIComponent(apiOrigin)}:${entry}:${encodeURIComponent(scenario.id)}:`;
  }
  private raw(name: string): string | null {
    try {
      return this.storage().getItem(this.prefix + name);
    } catch {
      return null;
    }
  }
  read<T>(name: string, schema: { parse(value: unknown): T }): T | undefined {
    try {
      const raw = this.raw(name);
      return raw && raw.length <= 512_000 ? schema.parse(JSON.parse(raw)) : undefined;
    } catch {
      return undefined;
    }
  }
  write(name: string, value: unknown): void {
    if ((name === 'draft' || name === 'history') && this.claimed && !this.ownsSession()) return;
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
    if (value) this.write('session', { version: 1, owner: this.owner, value });
    return value;
  }
  ownsSession(): boolean {
    const saved = this.read('session', envelopeSchema);
    return !saved || saved.owner === this.owner;
  }
  saveRecovery(value: BrowserRecovery): void {
    if (this.claimed && this.ownsSession())
      this.write('session', { version: 1, owner: this.owner, value });
  }
  onReplacement(callback: () => void): () => void {
    const listener = (event: StorageEvent) => {
      if (event.key === this.prefix + 'session' && this.claimed && !this.ownsSession()) callback();
    };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
  }
  clearReading(): void {
    this.claimRecovery();
    this.write('draft', '');
    this.write('history', []);
  }
}
