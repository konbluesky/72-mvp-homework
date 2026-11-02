import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { ScenarioDefinition, StoryCheckpoint } from '../scenario/ports.js';
import type {
  SpeechReadyPayload,
  PresentationEvent,
  StoryState,
  Facts,
  FrozenTurn,
  Receipt,
  SessionCreated,
  ScenarioIdentity,
  TurnIdentity,
  MessageAttempt,
  MediaVisualIntent,
  ImageShare,
  BeginTurnSchema,
} from '@mira/protocol';
import type { Config } from '../config/index.js';
import type { z } from 'zod';
import type { ImageWork } from '../images/types.js';
import { AppError } from '../http/errors.js';

interface IssuedTarget {
  kind: Receipt['kind'];
  shareId?: string;
  text?: string;
  confirmed?: Receipt;
  event?: PresentationEvent;
  dependencies?: string[];
  order?: number;
  checkpoint?: StoryCheckpoint;
}
export interface Turn {
  identity: TurnIdentity;
  messageId?: string;
  conversationSnapshot?: { revision: number; location: string };
  mediaShareId?: string;
  claimId?: string;
  contentDigest?: string;
  pendingUser?: string;
  userCommitted?: boolean;
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
  expiresAt: number | null;
  generation: number;
  current?: Turn;
  turns: Map<string, Turn>;
  facts: Facts;
  story: StoryState;
  narrative: StoryCheckpoint;
  history: Array<{ role: 'user' | 'assistant'; text: string; mode?: 'audio' | 'text' }>;
  inputTimes: number[];
  imageShares: Map<string, ImageWork>;
  imageMemory: Array<{ shareId: string; originLabel: string; presentedAt: number }>;
  mediaAllowed: boolean;
  confirmedConversation?: { revision: number; location: string };
}
export interface ManagerDependencies {
  scenario: ScenarioDefinition;
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
  readonly scenario: ScenarioDefinition;
  imageLifecycle?: {
    start(session: Session, work: ImageWork): void;
    removed(session: Session): void;
    assetAvailable(id: string, sessionId: string): boolean;
    discard(work: ImageWork): void;
  };

  constructor(
    private readonly config: Config,
    dependencies: ManagerDependencies,
  ) {
    this.scenario = dependencies.scenario;
    this.now = dependencies.now ?? Date.now;
    this.id = dependencies.id ?? randomUUID;
  }

  create(
    entry: 'story' | 'conversation' = 'story',
    replace?: Session,
    expectedScenario?: ScenarioIdentity,
  ): Omit<SessionCreated, 'capabilities'> {
    const narrative = this.scenario.initial(entry);
    if (
      expectedScenario &&
      (expectedScenario.id !== narrative.storyId || expectedScenario.version !== narrative.version)
    )
      throw new AppError(
        'SCENE_MODULE_VERSION_MISMATCH',
        409,
        '场景版本与服务端不一致，请刷新页面后重试。',
      );
    this.sweep();
    const replacing = replace && this.sessions.get(replace.id) === replace ? replace : undefined;
    if (this.closing || this.sessions.size - (replacing ? 1 : 0) >= this.config.MAX_SESSIONS) {
      throw new AppError('CAPACITY_EXCEEDED', 503, '服务暂时繁忙，请稍后再试。', true);
    }
    const id = this.id();
    const token = randomBytes(32).toString('base64url');
    const frame = this.scenario.frame(narrative);
    const session: Session = {
      id,
      tokenHash: hash(token),
      expiresAt:
        this.config.SESSION_TTL_SECONDS === 0
          ? null
          : this.now() + this.config.SESSION_TTL_SECONDS * 1000,
      generation: 0,
      turns: new Map(),
      facts: frame.facts,
      story: frame.story,
      narrative,
      history: [],
      inputTimes: [],
      imageShares: new Map(),
      imageMemory: [],
      mediaAllowed: true,
    };
    const created: Omit<SessionCreated, 'capabilities'> = {
      sessionId: id,
      sessionToken: token,
      expiresAt: session.expiresAt,
      mode: this.config.APP_MODE,
      scene: this.scene(session),
      ...(this.scenario.opening ? { opening: this.scenario.opening(narrative) } : {}),
    };
    // Prepare the replacement completely before retiring the previous session.
    if (replacing) this.remove(replacing);
    this.sessions.set(id, session);
    return created;
  }

  authenticate(id: string, authorization?: string): Session {
    const session = this.sessions.get(id);
    if (!session || (session.expiresAt !== null && session.expiresAt <= this.now())) {
      if (session) this.remove(session);
      throw new AppError('SESSION_EXPIRED', 410, '这次相遇已结束，请重新开始会话。', true);
    }
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token || !timingSafeEqual(session.tokenHash, hash(token))) {
      throw new AppError('UNAUTHORIZED', 401, '请重新开始会话。');
    }
    return session;
  }

  scene(session: Session) {
    const frame = this.scenario.frame(session.narrative);
    return {
      character: frame.presentation?.character ?? 'unassigned',
      environment: frame.presentation?.environment ?? 'default',
      scenario: { id: session.narrative.storyId, version: session.narrative.version },
      facts: { ...session.facts },
      story: { ...session.story, revealed: [...session.story.revealed] },
    };
  }

  snapshot(session: Session) {
    return {
      sessionId: session.id,
      generation: session.generation,
      scene: this.scene(session),
      history: [...session.history],
      imageShares: [...session.imageShares.values()]
        .filter((work) => work.slotConfirmed)
        .map((work) => this.imageProjection(work)),
      messageAttempts: [...session.turns.values()].flatMap((turn) =>
        turn.messageId ? [this.messageAttempt(turn)] : [],
      ),
    };
  }

  begin(session: Session, input: z.infer<typeof BeginTurnSchema>) {
    if (this.closing)
      throw new AppError('CAPACITY_EXCEEDED', 503, '服务正在维护，请稍后再来。', true);
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
    if (input.generation === session.generation && session.current?.messageId !== input.messageId)
      throw new AppError('INPUT_CONFLICT', 409, '同一条消息的标识不能改变。');
    if (input.messageId && input.generation > session.generation) {
      const messages = [...session.turns.values()].filter((turn) => turn.messageId);
      const previous = [...messages].reverse().find((turn) => turn.messageId === input.messageId);
      if (previous) {
        if (previous !== messages.at(-1))
          throw new AppError('STALE_TURN', 409, '后面已有新的对话，请作为新消息发送。');
        if (
          [...previous.targets.values()].some(
            (target) => target.confirmed?.status === 'presented',
          ) ||
          combined.some(
            (receipt) =>
              receipt.turnId === previous.identity.turnId && receipt.status === 'presented',
          )
        )
          throw new AppError('INPUT_COMPLETED', 409, '这条消息已有实际回应，请继续对话。');
        if (
          previous.status !== 'cancelled' &&
          !input.frozenTurns.some((snapshot) => snapshot.turnId === previous.identity.turnId)
        )
          throw new AppError('INPUT_IN_PROGRESS', 409, '这条消息正在回应中。');
      }
    }
    const acknowledged = this.receipts(session, combined, input.frozenTurns);
    for (const frozen of input.frozenTurns) this.freeze(session, frozen);
    if (input.generation === session.generation && session.current) {
      return {
        ...session.current.identity,
        status: session.current.status,
        acknowledged,
        ...(session.current.claimId ? { claimId: session.current.claimId } : {}),
      };
    }
    let claimed: ImageWork | undefined;
    const request = input.mediaPresentation;
    if (request) {
      claimed = session.imageShares.get(request.shareId);
      const current = session.current;
      const retired = current?.status === 'cancelled' && current.frozenFinal;
      if (
        input.messageId ||
        request.expectedGeneration !== session.generation ||
        input.generation !== session.generation + 1 ||
        !claimed ||
        claimed.share.version !== request.expectedShareVersion ||
        claimed.share.phase !== 'ready' ||
        claimed.claim ||
        !session.mediaAllowed ||
        !this.imageEligible(session, claimed) ||
        !claimed.share.assetId ||
        !this.imageLifecycle?.assetAvailable(claimed.share.assetId, session.id) ||
        (current &&
          !retired &&
          (!current.generationDone ||
            [...current.targets.values()].some((target) => !target.confirmed)))
      )
        throw new AppError('TURN_CONFLICT', 409, '照片稍后再看。', true);
    }
    if (session.current) this.cancel(session.current);
    const turn: Turn = {
      identity: { sessionId: session.id, generation: input.generation, turnId: input.turnId },
      ...(input.messageId ? { messageId: input.messageId } : {}),
      status: 'begun',
      abort: new AbortController(),
      targets: new Map(),
      receipts: new Map(),
      generationDone: false,
      waiters: new Set(),
      released: true,
    };
    if (claimed) {
      const claimId = this.id();
      turn.mediaShareId = claimed.share.shareId;
      turn.claimId = claimId;
      claimed.claim = { id: claimId, turn: turn.identity };
    }
    if (!input.mediaPresentation) session.mediaAllowed = false;
    session.generation = input.generation;
    session.current = turn;
    session.turns.set(input.turnId, turn);
    while (session.turns.size > this.config.MAX_TURNS_PER_SESSION) {
      const oldest = session.turns.keys().next().value;
      if (oldest === undefined) break;
      session.turns.delete(oldest);
    }
    return {
      ...turn.identity,
      status: turn.status,
      acknowledged,
      ...(turn.claimId ? { claimId: turn.claimId } : {}),
    };
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
    options: { expectAudio?: boolean; contentDigest?: string } = {},
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
    if (turn.messageId) {
      const previous = [...session.turns.values()]
        .reverse()
        .find(
          (candidate) =>
            candidate !== turn && candidate.messageId === turn.messageId && candidate.contentDigest,
        );
      if (previous && previous.contentDigest !== options.contentDigest)
        throw new AppError('INPUT_CONFLICT', 409, '重试不能改变原消息的内容。');
    }
    session.inputTimes = this.config.RATE_LIMIT_ENABLED
      ? session.inputTimes.filter((time) => time > this.now() - 60_000)
      : [];
    if (
      this.config.RATE_LIMIT_ENABLED &&
      session.inputTimes.length >= this.config.MAX_INPUTS_PER_MINUTE
    )
      throw new AppError('RATE_LIMITED', 429, '慢一点，我们还有时间。', true);
    if (this.active >= this.config.MAX_ACTIVE_TURNS)
      throw new AppError('CAPACITY_EXCEEDED', 503, '回应有些拥挤，请稍后再试。', true);
    turn.input = { id: inputId, digest };
    turn.contentDigest = options.contentDigest;
    turn.status = 'running';
    turn.released = false;
    this.active += 1;
    if (this.config.RATE_LIMIT_ENABLED) session.inputTimes.push(this.now());
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
    turn.pendingUser = text;
  }

  issue(session: Session, turn: Turn, payload: SpeechReadyPayload): void {
    this.assertCurrent(session, turn);
    turn.targets.set(payload.segmentId, { kind: 'segment', text: payload.text });
    this.issueEvents(session, turn, payload.events);
  }

  issueEvents(
    session: Session,
    turn: Turn,
    events: PresentationEvent[],
    ordered = false,
    predecessors: string[] = [],
    checkpoint?: StoryCheckpoint,
  ): void {
    this.assertCurrent(session, turn);
    const dependencies: string[] = [...predecessors];
    for (const event of events) {
      turn.targets.set(event.eventId, {
        kind: event.type,
        event,
        dependencies: ordered ? [...dependencies] : [],
        order: turn.identity.generation * 1000 + turn.targets.size,
        ...(event === events.at(-1) && checkpoint ? { checkpoint } : {}),
      });
      dependencies.push(event.eventId);
    }
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
    const ordered = [...receipts].sort(
      (a, b) =>
        (session.turns.get(a.turnId)?.targets.get(a.targetId)?.order ?? 0) -
        (session.turns.get(b.turnId)?.targets.get(b.targetId)?.order ?? 0),
    );
    for (const receipt of ordered) {
      const turn = session.turns.get(receipt.turnId);
      const target = turn?.targets.get(receipt.targetId);
      if (!turn || !target) continue; // Validation above guarantees both; keeps narrowing explicit.
      acknowledged.push(receipt.receiptId);
      if (turn.receipts.has(receipt.receiptId)) continue;
      turn.receipts.set(receipt.receiptId, receiptDigest(receipt));
      if (target.confirmed?.status === 'presented') continue;
      target.confirmed = receipt;
      if (receipt.status === 'presented') {
        // A failed, unheard attempt must never pollute the next planner context.
        if (turn.pendingUser && !turn.userCommitted) {
          session.history.push({ role: 'user', text: turn.pendingUser });
          turn.userCommitted = true;
          session.history = session.history.slice(-40);
        }
        if (target.shareId && target.kind === 'image-slot') {
          const work = session.imageShares.get(target.shareId);
          if (
            work &&
            !work.slotConfirmed &&
            work.share.phase === 'preparing' &&
            work.work === 'awaiting-slot'
          ) {
            work.slotConfirmed = true;
            work.work = 'queued';
            work.share.version++;
            this.imageLifecycle?.start(session, work);
          }
        } else if (target.shareId && target.kind === 'image') {
          const work = session.imageShares.get(target.shareId);
          if (
            work &&
            work.share.phase === 'ready' &&
            work.claim &&
            work.claim.id === turn.claimId &&
            work.claim.turn.sessionId === turn.identity.sessionId &&
            work.claim.turn.turnId === turn.identity.turnId &&
            work.claim.turn.generation === turn.identity.generation &&
            work.claim.imageEventId === receipt.targetId
          ) {
            const presentedAt = this.now();
            work.share = {
              ...work.share,
              version: work.share.version + 1,
              phase: 'presented',
              presentedAt,
            };
            session.imageMemory.push({
              shareId: work.share.shareId,
              originLabel: work.share.originLabel,
              presentedAt,
            });
            work.claim = undefined;
          }
        }
        if (target.kind === 'segment' && target.text) {
          session.history.push({
            role: 'assistant',
            text: target.text,
            mode: receipt.mode ?? 'audio',
          });
          session.history = session.history.slice(-40);
        } else if (target.checkpoint) {
          const next = this.scenario.accept(session.narrative, target.checkpoint);
          const frame = this.scenario.frame(next);
          session.narrative = next;
          session.story = frame.story;
          session.facts = frame.facts;
          delete target.checkpoint;
        }
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
    const session = this.sessions.get(turn.identity.sessionId);
    if (session)
      for (const work of session.imageShares.values()) {
        if (
          turn.frozenFinal &&
          work.claim?.turn.turnId === turn.identity.turnId &&
          work.claim.turn.generation === turn.identity.generation
        )
          work.claim = undefined;
      }
    if (session) this.releaseUnseenImageReservations(session, turn);
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
    let checkpoint = session.narrative;
    const visited = new Set<string>();
    for (const receipt of [...receipts].sort(
      (a, b) =>
        (session.turns.get(a.turnId)?.targets.get(a.targetId)?.order ?? 0) -
        (session.turns.get(b.turnId)?.targets.get(b.targetId)?.order ?? 0),
    )) {
      const target = session.turns.get(receipt.turnId)?.targets.get(receipt.targetId);
      const key = `${receipt.turnId}:${receipt.targetId}`;
      if (
        receipt.status !== 'presented' ||
        target?.confirmed?.status === 'presented' ||
        !target?.checkpoint ||
        visited.has(key)
      )
        continue;
      visited.add(key);
      checkpoint = this.scenario.accept(checkpoint, target.checkpoint);
    }

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
      if (
        receipt.status === 'presented' &&
        target.dependencies?.some(
          (id) =>
            turn.targets.get(id)?.confirmed?.status !== 'presented' &&
            !receipts.some(
              (candidate) =>
                candidate.turnId === receipt.turnId &&
                candidate.generation === receipt.generation &&
                candidate.targetId === id &&
                candidate.status === 'presented',
            ),
        )
      )
        throw new AppError('INVALID_REQUEST', 400, '前置场景尚未呈现。');
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

  private releaseUnseenImageReservations(session: Session, turn: Turn): void {
    // A provisional disconnect may still carry a visible-slot receipt in its first final snapshot.
    if (!turn.frozenFinal) return;
    for (const work of session.imageShares.values()) {
      if (
        work.slotConfirmed ||
        !(
          (work.work === 'awaiting-slot' && work.share.phase === 'preparing') ||
          (work.work === 'ended' && work.share.phase === 'expired')
        ) ||
        work.sourceTurn.sessionId !== turn.identity.sessionId ||
        work.sourceTurn.turnId !== turn.identity.turnId ||
        work.sourceTurn.generation !== turn.identity.generation
      )
        continue;
      this.endImage(session, work, 'cancelled');
      session.imageShares.delete(work.share.shareId);
      // The old issued target remains in its frozen turn and cannot accept a late success.
      // Confirmed slots and explicit terminal decisions keep their session allowance.
    }
  }

  private freeze(session: Session, frozen: FrozenTurn): void {
    this.validateFrozen(session, frozen);
    const turn = session.turns.get(frozen.turnId);
    if (!turn || turn.frozenFinal) return;
    turn.frozenFinal = true;
    for (const work of session.imageShares.values())
      if (
        work.claim &&
        work.claim.id === turn.claimId &&
        work.claim.turn.turnId === turn.identity.turnId &&
        work.claim.turn.generation === turn.identity.generation
      )
        work.claim = undefined;
    // Only provisional disconnects need candidate states for the first explicit snapshot.
    // Once frozen, unpresented branches cannot be extended and need not retain full Ink JSON.
    for (const target of turn.targets.values()) {
      if (target.confirmed?.status !== 'presented') delete target.checkpoint;
    }
    this.releaseUnseenImageReservations(session, turn);
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

  private messageAttempt(turn: Turn): MessageAttempt {
    const targets = [...turn.targets.values()];
    const presented = targets.some((target) => target.confirmed?.status === 'presented');
    const completed =
      turn.generationDone &&
      targets.length > 0 &&
      targets.every((target) => target.confirmed?.status === 'presented');
    return {
      ...turn.identity,
      messageId: turn.messageId!,
      status: completed
        ? 'completed'
        : turn.failure
          ? 'failed'
          : turn.status === 'cancelled'
            ? 'interrupted'
            : 'pending',
      presented,
      retryable:
        !completed &&
        !presented &&
        turn.status === 'cancelled' &&
        (!turn.failure || turn.failure.retryable || turn.failure.code === 'INTERNAL_ERROR'),
      error: completed ? '' : (turn.failure?.message ?? ''),
    };
  }

  private finishIfPresented(turn: Turn): void {
    if (turn.generationDone && [...turn.targets.values()].every((target) => target.confirmed)) {
      const session = this.sessions.get(turn.identity.sessionId);
      if (
        session &&
        turn.conversationSnapshot &&
        turn.targets.size &&
        [...turn.targets.values()].every((target) => target.confirmed?.status === 'presented')
      )
        session.confirmedConversation = turn.conversationSnapshot;
      clearTimeout(turn.timer);
      turn.timer = undefined;
    }
  }

  imageProjection(work: ImageWork): ImageShare {
    return {
      ...work.share,
      longWait: this.now() - work.share.announcedAt >= this.config.IMAGE_LONG_WAIT_MS,
      canRetryGeneration: work.share.phase === 'failed' && work.attemptCount < 2,
      ...(work.share.presentedAt && work.share.assetId
        ? { assetId: work.share.assetId }
        : { assetId: undefined }),
    };
  }
  imageCandidate(session: Session) {
    const confirmed = session.confirmedConversation;
    if (
      !confirmed ||
      confirmed.revision !== session.narrative.revision ||
      confirmed.location !== session.story.location
    )
      return undefined;
    return this.scenario.imageSharing?.candidate(session.narrative, session.history);
  }
  imageEligible(session: Session, work: ImageWork): boolean {
    return (
      this.sessions.get(session.id) === session &&
      this.now() < work.share.expiresAt &&
      !!this.scenario.imageSharing?.accepts(session.narrative, work.recipe)
    );
  }
  reserveImage(
    session: Session,
    turn: Turn,
    intent: MediaVisualIntent,
    simulated: boolean,
  ): ImageWork | undefined {
    this.assertCurrent(session, turn);
    if (session.imageShares.size) return undefined;
    const candidate = this.imageCandidate(session);
    if (!candidate) return undefined;
    const shareId = this.id();
    const now = this.now();
    const work: ImageWork = {
      share: {
        shareId,
        attemptId: this.id(),
        version: 1,
        phase: 'preparing',
        originLabel: candidate.originLabel,
        title: candidate.title,
        width: candidate.width,
        height: candidate.height,
        expiresAt: now + this.config.IMAGE_JOB_TIMEOUT_MS,
        announcedAt: now,
        simulated,
        canRetryGeneration: false,
        longWait: false,
      },
      recipe: { ...candidate, intent, seed: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER) },
      sourceTurn: turn.identity,
      slotEventId: this.id(),
      slotConfirmed: false,
      attemptCount: 1,
      work: 'awaiting-slot',
      abort: new AbortController(),
    };
    session.imageShares.set(shareId, work);
    return work;
  }
  issueImageSlot(session: Session, turn: Turn, work: ImageWork): void {
    this.assertCurrent(session, turn);
    turn.targets.set(work.slotEventId, { kind: 'image-slot', shareId: work.share.shareId });
  }
  imageDecision(
    session: Session,
    decision: 'prepare' | 'defer' | 'dismiss' | 'keep' | undefined,
  ): void {
    session.mediaAllowed = decision !== 'defer' && decision !== 'dismiss';
    if (decision === 'dismiss')
      for (const work of session.imageShares.values())
        if (work.share.phase !== 'presented') this.endImage(session, work, 'cancelled');
  }
  updateImage(
    session: Session,
    work: ImageWork,
    attemptId: string,
    patch: Partial<ImageShare>,
    state: ImageWork['work'],
  ): boolean {
    if (
      this.sessions.get(session.id) !== session ||
      session.imageShares.get(work.share.shareId) !== work ||
      work.share.attemptId !== attemptId ||
      ['cancelled', 'expired', 'presented'].includes(work.share.phase) ||
      work.abort.signal.aborted
    )
      return false;
    if (work.share.expiresAt <= this.now()) {
      this.endImage(session, work, 'expired');
      return false;
    }
    work.work = state;
    work.share = { ...work.share, ...patch, version: work.share.version + 1 };
    return true;
  }
  getImage(session: Session, id: string): ImageWork {
    const work = session.imageShares.get(id);
    if (!work || !work.slotConfirmed)
      throw new AppError('MEDIA_NOT_FOUND', 404, '这张照片的准备记录已结束。');
    if (work.share.expiresAt <= this.now() && !['cancelled', 'expired'].includes(work.share.phase))
      this.endImage(session, work, 'expired');
    return work;
  }
  endImage(session: Session, work: ImageWork, phase: 'cancelled' | 'expired'): void {
    if (['cancelled', 'expired'].includes(work.share.phase)) return;
    work.share = {
      ...work.share,
      phase,
      version: work.share.version + 1,
      reason: phase === 'cancelled' ? 'cancelled' : 'deadline',
      canRetryGeneration: false,
    };
    work.work = 'ended';
    work.claim = undefined;
    work.abort.abort();
    this.imageLifecycle?.discard(work);
    const current = session.current;
    if (current?.mediaShareId === work.share.shareId && !current.abort.signal.aborted)
      this.cancel(current);
  }
  retryImage(
    session: Session,
    work: ImageWork,
    request: { requestId: string; expectedVersion: number },
  ): void {
    if (work.retryRequestId === request.requestId) return;
    if (
      work.share.version !== request.expectedVersion ||
      work.share.phase !== 'failed' ||
      work.attemptCount >= 2 ||
      !this.imageEligible(session, work)
    )
      throw new AppError('TURN_CONFLICT', 409, '这张照片暂时不能重新准备。');
    work.retryRequestId = request.requestId;
    work.attemptCount++;
    work.abort = new AbortController();
    work.work = 'queued';
    work.share = {
      ...work.share,
      attemptId: this.id(),
      phase: 'preparing',
      version: work.share.version + 1,
      expiresAt: this.now() + this.config.IMAGE_JOB_TIMEOUT_MS,
      announcedAt: this.now(),
      reason: undefined,
    };
    this.imageLifecycle?.start(session, work);
  }
  claimImage(session: Session, turn: Turn, id: string, claimId: string): ImageWork {
    this.assertCurrent(session, turn);
    const work = this.getImage(session, id);
    if (
      turn.mediaShareId !== id ||
      turn.claimId !== claimId ||
      work.claim?.id !== claimId ||
      work.claim.turn.turnId !== turn.identity.turnId ||
      work.share.phase !== 'ready' ||
      !this.imageEligible(session, work) ||
      !work.share.assetId ||
      !this.imageLifecycle?.assetAvailable(work.share.assetId, session.id)
    )
      throw new AppError('TURN_CONFLICT', 409, '照片稍后再看。');
    return work;
  }
  issueImage(session: Session, turn: Turn, work: ImageWork, eventId: string): void {
    this.assertCurrent(session, turn);
    if (!work.claim || work.claim.turn.turnId !== turn.identity.turnId)
      throw new AppError('TURN_CONFLICT', 409, '照片稍后再看。');
    work.claim.imageEventId = eventId;
    turn.targets.set(eventId, { kind: 'image', shareId: work.share.shareId });
  }

  sweep(): void {
    for (const session of this.sessions.values()) {
      if (session.expiresAt !== null && session.expiresAt <= this.now()) this.remove(session);
      else
        for (const work of session.imageShares.values())
          if (
            work.share.expiresAt <= this.now() &&
            !['cancelled', 'expired'].includes(work.share.phase)
          )
            this.endImage(session, work, 'expired');
    }
  }

  private remove(session: Session): void {
    for (const turn of session.turns.values()) this.cancel(turn);
    for (const work of session.imageShares.values()) this.endImage(session, work, 'cancelled');
    this.sessions.delete(session.id);
    this.imageLifecycle?.removed(session);
  }

  close(): void {
    this.closing = true;
    for (const session of this.sessions.values()) this.remove(session);
  }
}
