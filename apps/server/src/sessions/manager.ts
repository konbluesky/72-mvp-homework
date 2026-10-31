import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  AudioReadyPayload,
  Facts,
  FrozenTurn,
  Receipt,
  SessionCreated,
  TurnIdentity,
} from '@mira/protocol';
import type { Config } from '../config/index.js';
import { AppError } from '../http/errors.js';

interface IssuedTarget {
  kind: Receipt['kind'];
  text?: string;
  confirmed?: Receipt;
}
export interface Turn {
  identity: TurnIdentity;
  status: 'begun' | 'running' | 'completed' | 'cancelled';
  abort: AbortController;
  input?: { id: string; digest: string };
  targets: Map<string, IssuedTarget>;
  receipts: Map<string, string>;
  frozen?: Set<string>;
  frozenFinal?: boolean;
  generationDone: boolean;
  timer?: ReturnType<typeof setTimeout>;
  firstAudioTimer?: ReturnType<typeof setTimeout>;
  failure?: AppError;
  waiters: Set<() => void>;
  streamId?: string;
  released: boolean;
  deadlineAt?: number;
  uploadRequestId?: string;
}
export interface Session {
  id: string;
  tokenHash: Buffer;
  expiresAt: number;
  generation: number;
  current?: Turn;
  turns: Map<string, Turn>;
  facts: Facts;
  history: Array<{ role: 'user' | 'assistant'; text: string; mode?: 'audio' | 'text' }>;
  inputTimes: number[];
}
export interface ManagerDependencies {
  now?: () => number;
  id?: () => string;
}
const receiptKey = (r: Receipt) => `${r.targetId}:${r.kind}:${r.status}:${r.mode ?? ''}`;
const receiptDigest = (r: Receipt) => JSON.stringify(r);
const hash = (text: string) => createHash('sha256').update(text).digest();

export class SessionManager {
  readonly sessions = new Map<string, Session>();
  private active = 0;
  private readonly now: () => number;
  private readonly id: () => string;
  private closing = false;

  constructor(
    private readonly config: Config,
    dependencies: ManagerDependencies = {},
  ) {
    this.now = dependencies.now ?? Date.now;
    this.id = dependencies.id ?? randomUUID;
  }

  create(): Omit<SessionCreated, 'capabilities'> {
    this.sweep();
    if (this.closing || this.sessions.size >= this.config.MAX_SESSIONS) {
      throw new AppError('CAPACITY_EXCEEDED', 503, '店里暂时有些忙，请稍后再来。', true);
    }
    const id = this.id();
    const token = randomBytes(32).toString('base64url');
    const session: Session = {
      id,
      tokenHash: hash(token),
      expiresAt: this.now() + this.config.SESSION_TTL_SECONDS * 1000,
      generation: 0,
      turns: new Map(),
      facts: { photo_revealed: false, rain_softened: false },
      history: [],
      inputTimes: [],
    };
    this.sessions.set(id, session);
    return {
      sessionId: id,
      sessionToken: token,
      expiresAt: session.expiresAt,
      mode: this.config.APP_MODE,
      scene: this.scene(session),
    };
  }

  authenticate(id: string, authorization?: string): Session {
    const session = this.sessions.get(id);
    if (!session || session.expiresAt <= this.now()) {
      if (session) this.remove(session);
      throw new AppError('SESSION_EXPIRED', 410, '这次相遇已结束，请重新进入咖啡馆。', true);
    }
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token || !timingSafeEqual(session.tokenHash, hash(token))) {
      throw new AppError('UNAUTHORIZED', 401, '请重新进入咖啡馆。');
    }
    return session;
  }

  scene(session: Session) {
    return {
      character: 'mira' as const,
      environment: session.facts.rain_softened ? ('rain-soft' as const) : ('rain' as const),
      facts: { ...session.facts },
    };
  }

  snapshot(session: Session) {
    return {
      sessionId: session.id,
      generation: session.generation,
      scene: this.scene(session),
      history: [...session.history],
    };
  }

  begin(
    session: Session,
    input: { generation: number; turnId: string; receipts: Receipt[]; frozenTurns: FrozenTurn[] },
  ) {
    if (this.closing)
      throw new AppError('CAPACITY_EXCEEDED', 503, '咖啡馆正在整理，请稍后再来。', true);
    if (input.generation < session.generation)
      throw new AppError('STALE_TURN', 409, '旧的回应已结束。');
    if (
      input.generation === session.generation &&
      session.current?.identity.turnId !== input.turnId
    ) {
      throw new AppError('TURN_CONFLICT', 409, '这次回应与另一条输入冲突。', true);
    }
    if (input.generation > session.generation && session.turns.has(input.turnId)) {
      throw new AppError('TURN_CONFLICT', 409, '请为新回应使用新的标识。', true);
    }
    // Validate the entire batch before advancing the current owner or committing facts.
    const combined = [
      ...input.receipts,
      ...input.frozenTurns.flatMap((snapshot) => snapshot.receipts),
    ];
    for (const frozen of input.frozenTurns) this.validateFrozen(session, frozen);
    this.validateReceipts(session, combined, input.frozenTurns);
    const acknowledged = this.receipts(session, combined, input.frozenTurns);
    for (const frozen of input.frozenTurns) this.freeze(session, frozen);
    if (input.generation === session.generation && session.current) {
      return { ...session.current.identity, status: session.current.status, acknowledged };
    }
    if (session.current) this.cancel(session.current);
    const turn: Turn = {
      identity: { sessionId: session.id, generation: input.generation, turnId: input.turnId },
      status: 'begun',
      abort: new AbortController(),
      targets: new Map(),
      receipts: new Map(),
      generationDone: false,
      waiters: new Set(),
      released: true,
    };
    session.generation = input.generation;
    session.current = turn;
    session.turns.set(input.turnId, turn);
    while (session.turns.size > this.config.MAX_TURNS_PER_SESSION) {
      const oldest = session.turns.keys().next().value;
      if (oldest === undefined) break;
      session.turns.delete(oldest);
    }
    return { ...turn.identity, status: turn.status, acknowledged };
  }

  getTurn(session: Session, turnId: string, generation: number): Turn {
    const turn = session.turns.get(turnId);
    if (!turn || turn.identity.generation !== generation)
      throw new AppError('STALE_TURN', 409, '旧的回应已结束。');
    return turn;
  }

  startInput(
    session: Session,
    turnId: string,
    generation: number,
    inputId: string,
    digest: string,
    options: { expectAudio?: boolean } = {},
  ): Turn {
    const turn = this.getTurn(session, turnId, generation);
    if (turn.input) {
      if (turn.input.id !== inputId || turn.input.digest !== digest)
        throw new AppError('INPUT_CONFLICT', 409, '同一条输入的内容不能改变。');
      const code =
        turn.status === 'running'
          ? 'INPUT_IN_PROGRESS'
          : turn.status === 'completed'
            ? 'INPUT_COMPLETED'
            : 'TURN_CANCELLED';
      throw new AppError(
        code,
        409,
        code === 'INPUT_IN_PROGRESS' ? '这条输入正在回应中。' : '这条输入已处理，不会重复播放。',
      );
    }
    if (session.current !== turn || turn.abort.signal.aborted || turn.status !== 'begun')
      throw new AppError('TURN_CANCELLED', 409, '旧的回应已结束。');
    session.inputTimes = session.inputTimes.filter((time) => time > this.now() - 60_000);
    if (session.inputTimes.length >= this.config.MAX_INPUTS_PER_MINUTE)
      throw new AppError('RATE_LIMITED', 429, '慢一点，我们还有时间。', true);
    if (this.active >= this.config.MAX_ACTIVE_TURNS)
      throw new AppError('CAPACITY_EXCEEDED', 503, '回应有些拥挤，请稍后再试。', true);
    turn.input = { id: inputId, digest };
    turn.status = 'running';
    turn.released = false;
    this.active += 1;
    session.inputTimes.push(this.now());
    turn.deadlineAt = this.now() + this.config.TURN_MAX_LIFETIME_MS;
    turn.timer = setTimeout(
      () =>
        this.fail(turn, new AppError('TURN_TIMEOUT', 504, '这次回应等得太久，请再试一次。', true)),
      this.config.TURN_MAX_LIFETIME_MS,
    );
    if (options.expectAudio !== false)
      turn.firstAudioTimer = setTimeout(
        () =>
          this.fail(
            turn,
            new AppError('FIRST_AUDIO_TIMEOUT', 504, '声音还没有准备好，请再试一次。', true),
          ),
        this.config.FIRST_AUDIO_TIMEOUT_MS,
      );
    turn.timer.unref();
    turn.firstAudioTimer?.unref();
    return turn;
  }

  assertCurrent(session: Session, turn: Turn): void {
    if (session.current !== turn || turn.abort.signal.aborted)
      throw turn.failure ?? new AppError('TURN_CANCELLED', 409, '旧的回应已结束。');
  }

  addUser(session: Session, turn: Turn, text: string): void {
    this.assertCurrent(session, turn);
    session.history.push({ role: 'user', text });
    session.history = session.history.slice(-40);
  }

  issue(session: Session, turn: Turn, payload: AudioReadyPayload): void {
    this.assertCurrent(session, turn);
    turn.targets.set(payload.segmentId, { kind: 'segment', text: payload.text });
    for (const event of payload.events) turn.targets.set(event.eventId, { kind: event.type });
  }

  remainingLifetime(turn: Turn): number {
    return Math.max(1, (turn.deadlineAt ?? this.now()) - this.now());
  }

  firstAudioPublished(turn: Turn): void {
    clearTimeout(turn.firstAudioTimer);
    turn.firstAudioTimer = undefined;
  }

  generated(turn: Turn): void {
    if (turn.abort.signal.aborted) return;
    turn.generationDone = true;
    turn.status = 'completed';
    this.release(turn);
    this.finishIfPresented(turn);
  }

  receipts(session: Session, receipts: Receipt[], explicitSnapshots: FrozenTurn[] = []): string[] {
    this.validateReceipts(session, receipts, explicitSnapshots);
    const acknowledged: string[] = [];
    for (const receipt of receipts) {
      const turn = session.turns.get(receipt.turnId);
      const target = turn?.targets.get(receipt.targetId);
      if (!turn || !target) continue; // Validation above guarantees both; keeps narrowing explicit.
      acknowledged.push(receipt.receiptId);
      if (turn.receipts.has(receipt.receiptId)) continue;
      turn.receipts.set(receipt.receiptId, receiptDigest(receipt));
      if (target.confirmed?.status === 'presented') continue;
      target.confirmed = receipt;
      if (receipt.status === 'presented') {
        if (target.kind === 'segment' && target.text) {
          session.history.push({
            role: 'assistant',
            text: target.text,
            mode: receipt.mode ?? 'audio',
          });
          session.history = session.history.slice(-40);
        } else if (target.kind === 'photo') session.facts.photo_revealed = true;
        else if (target.kind === 'environment') session.facts.rain_softened = true;
      }
      for (const notify of turn.waiters) notify();
      this.finishIfPresented(turn);
    }
    return [...new Set(acknowledged)];
  }

  cancelRequest(
    session: Session,
    turnId: string,
    generation: number,
    receipts: Receipt[],
  ): string[] {
    const turn = this.getTurn(session, turnId, generation);
    const snapshot = { turnId, generation, receipts };
    this.validateFrozen(session, snapshot);
    this.validateReceipts(session, receipts, [snapshot]);
    const acknowledged = this.receipts(session, receipts, [snapshot]);
    this.freeze(session, { turnId, generation, receipts });
    this.cancel(turn);
    return acknowledged;
  }

  cancel(turn: Turn): void {
    if (!turn.frozen)
      turn.frozen = new Set(
        [...turn.targets.values()].flatMap((target) =>
          target.confirmed ? [receiptKey(target.confirmed)] : [],
        ),
      );
    if (turn.status !== 'cancelled') {
      turn.status = 'cancelled';
      turn.abort.abort(turn.failure ?? new AppError('TURN_CANCELLED', 409, '旧的回应已结束。'));
    }
    clearTimeout(turn.timer);
    clearTimeout(turn.firstAudioTimer);
    this.release(turn);
    for (const notify of turn.waiters) notify();
    turn.waiters.clear();
  }

  fail(turn: Turn, error: AppError): void {
    turn.failure = error;
    this.cancel(turn);
  }

  async waitForPresentation(session: Session, turn: Turn, segmentId: string): Promise<void> {
    this.assertCurrent(session, turn);
    if (turn.targets.get(segmentId)?.confirmed) return;
    await new Promise<void>((resolve, reject) => {
      const check = () => {
        if (turn.abort.signal.aborted) {
          turn.waiters.delete(check);
          reject(turn.failure ?? new AppError('TURN_CANCELLED', 409, '旧的回应已结束。'));
        } else if (turn.targets.get(segmentId)?.confirmed) {
          turn.waiters.delete(check);
          resolve();
        }
      };
      turn.waiters.add(check);
      check();
    });
    this.assertCurrent(session, turn);
  }

  private validateReceipts(
    session: Session,
    receipts: Receipt[],
    explicitSnapshots: FrozenTurn[] = [],
  ): void {
    const batch = new Map<string, string>();
    const additions = new Map<string, Set<string>>();
    const photoPresented =
      session.facts.photo_revealed ||
      receipts.some((receipt) => receipt.kind === 'photo' && receipt.status === 'presented');
    for (const receipt of receipts) {
      const turn = session.turns.get(receipt.turnId);
      const target = turn?.targets.get(receipt.targetId);
      if (
        receipt.sessionId !== session.id ||
        !turn ||
        turn.identity.generation !== receipt.generation ||
        !target ||
        target.kind !== receipt.kind
      ) {
        throw new AppError('INVALID_REQUEST', 400, '呈现记录与这次相遇不匹配。');
      }
      if (receipt.kind === 'environment' && receipt.status === 'presented' && !photoPresented)
        throw new AppError('INVALID_REQUEST', 400, '照片尚未呈现，环境不能先改变。');
      const digest = receiptDigest(receipt);
      const previous = turn.receipts.get(receipt.receiptId) ?? batch.get(receipt.receiptId);
      if (previous && previous !== digest)
        throw new AppError('INPUT_CONFLICT', 409, '呈现记录不能重复改写。');
      const explicit =
        !turn.frozenFinal &&
        explicitSnapshots.some(
          (snapshot) =>
            snapshot.turnId === receipt.turnId &&
            snapshot.generation === receipt.generation &&
            snapshot.receipts.some((candidate) => receiptKey(candidate) === receiptKey(receipt)),
        );
      if (!previous && turn.frozen && !turn.frozen.has(receiptKey(receipt)) && !explicit) {
        throw new AppError('STALE_TURN', 409, '已结束的回应不能追加呈现结果。');
      }
      const added = additions.get(receipt.turnId) ?? new Set<string>();
      if (!turn.receipts.has(receipt.receiptId)) added.add(receipt.receiptId);
      additions.set(receipt.turnId, added);
      if (turn.receipts.size + added.size > 64)
        throw new AppError('CAPACITY_EXCEEDED', 429, '这次回应的记录已满。');
      batch.set(receipt.receiptId, digest);
    }
  }

  private validateFrozen(session: Session, frozen: FrozenTurn): void {
    const turn = session.turns.get(frozen.turnId);
    // A local intent may be superseded before its begin request ever reaches this server.
    if (!turn && frozen.receipts.length === 0) return;
    if (!turn || turn.identity.generation !== frozen.generation)
      throw new AppError('STALE_TURN', 409, '冻结记录与回应不匹配。');
    if (
      frozen.receipts.some(
        (receipt) => receipt.turnId !== frozen.turnId || receipt.generation !== frozen.generation,
      )
    ) {
      throw new AppError('INVALID_REQUEST', 400, '冻结记录与回应不匹配。');
    }
    if (
      turn.frozenFinal &&
      frozen.receipts.some((receipt) => !turn.frozen?.has(receiptKey(receipt)))
    ) {
      throw new AppError('STALE_TURN', 409, '已冻结的记录不能追加。');
    }
  }

  private freeze(session: Session, frozen: FrozenTurn): void {
    this.validateFrozen(session, frozen);
    const turn = session.turns.get(frozen.turnId);
    if (!turn || turn.frozenFinal) return;
    turn.frozenFinal = true;
    turn.frozen = new Set([
      ...frozen.receipts.map(receiptKey),
      ...[...turn.targets.values()].flatMap((target) =>
        target.confirmed ? [receiptKey(target.confirmed)] : [],
      ),
    ]);
  }

  private release(turn: Turn): void {
    if (!turn.released) {
      turn.released = true;
      this.active -= 1;
    }
  }

  private finishIfPresented(turn: Turn): void {
    if (turn.generationDone && [...turn.targets.values()].every((target) => target.confirmed)) {
      clearTimeout(turn.timer);
      turn.timer = undefined;
    }
  }

  sweep(): void {
    for (const session of this.sessions.values())
      if (session.expiresAt <= this.now()) this.remove(session);
  }

  private remove(session: Session): void {
    for (const turn of session.turns.values()) this.cancel(turn);
    this.sessions.delete(session.id);
  }

  close(): void {
    this.closing = true;
    for (const session of this.sessions.values()) this.remove(session);
  }
}
