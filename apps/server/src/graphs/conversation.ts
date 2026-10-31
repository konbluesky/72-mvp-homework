import { randomUUID } from 'node:crypto';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import {
  ReplyPlanSchema,
  type AudioReadyPayload,
  type ReplyPlan,
  type ServerEvent,
} from '@mira/protocol';
import type { Config } from '../config/index.js';
import type { ProviderSet } from '../providers/index.js';
import type { MediaService } from '../media/index.js';
import { AppError } from '../http/errors.js';
import { normalizeRecording } from '../providers/audio-input.js';
import { timed, type StageLogger } from '../observability/stages.js';
import { validateStory } from '../scenario/rules.js';
import type { Session, SessionManager, Turn } from '../sessions/manager.js';

export type TurnInput =
  { kind: 'text'; text: string } | { kind: 'audio'; bytes: Uint8Array; mimeType: string };
type EventContent = ServerEvent extends infer E
  ? E extends ServerEvent
    ? Pick<E, 'type' | 'payload'>
    : never
  : never;
export type Publish = (event: EventContent) => Promise<void>;
export interface ConversationDependencies {
  config: Config;
  providers: ProviderSet;
  media: MediaService;
  sessions: SessionManager;
  logger: StageLogger;
  id?: () => string;
}
const GraphState = Annotation.Root({
  text: Annotation<string>(),
  raw: Annotation<unknown>(),
  plan: Annotation<ReplyPlan | null>(),
  valid: Annotation<boolean>(),
  repairCount: Annotation<number>(),
});

/** A non-cooperative upstream can finish later, but cannot keep the graph alive or publish. */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        if (!signal.aborted) resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

export async function runConversation(
  dependencies: ConversationDependencies,
  session: Session,
  turn: Turn,
  input: TurnInput,
  publish: Publish,
): Promise<void> {
  const { config, providers, media, sessions, logger } = dependencies;
  const id = dependencies.id ?? randomUUID;
  const signal = turn.abort.signal;
  const active = () => sessions.assertCurrent(session, turn);
  const stage = <T>(name: string, operation: () => Promise<T>) =>
    timed(logger, turn.identity, name, async () => {
      active();
      const value = await abortable(operation(), signal);
      active();
      return value;
    });
  const context = (text: string, repair?: unknown) => ({
    text,
    facts: Object.entries(session.facts)
      .filter(([, value]) => value)
      .map(([key]) => key),
    history: [...session.history],
    ...(repair === undefined ? {} : { repair }),
  });

  const graph = new StateGraph(GraphState)
    .addNode('normalize_input', async () => {
      active();
      return {
        text: input.kind === 'text' ? input.text.trim() : '',
        repairCount: 0,
        valid: false,
        plan: null,
      };
    })
    .addNode('transcribe', async () => {
      if (input.kind !== 'audio') return {};
      const transcribe = providers.stt?.transcribe.bind(providers.stt);
      if (!transcribe)
        throw new AppError('UNSUPPORTED_AUDIO', 415, '当前模式暂不支持语音输入，请使用文字输入。');
      const normalized = await stage('recording_decode', () =>
        normalizeRecording(input, config, signal),
      );
      logger.info({
        ...turn.identity,
        stage: 'recording',
        durationMs: normalized.durationMs,
        inputBytes: input.bytes.length,
      });
      logger.info({ ...turn.identity, stage: 'stt_provider', ...providers.stt?.info });
      const transcription = await stage('stt', () => transcribe(normalized, signal));
      const text = transcription.text.trim();
      logger.info({
        ...turn.identity,
        stage: 'stt_result',
        providerRequestId: transcription.requestId ?? 'unknown',
        audioDurationSeconds: transcription.durationSeconds ?? 'unknown',
      });
      if (!text || text.length > 1000)
        throw new AppError('PROVIDER_FAILED', 502, '刚才没有听清，可以再说一次或打字。', true);
      await publish({
        type: 'input.transcribed',
        payload: { text, simulated: transcription.simulated },
      });
      return { text };
    })
    .addNode('build_context', async (state) => {
      sessions.addUser(session, turn, state.text);
      return {};
    })
    .addNode('plan_reply', async (state) => {
      logger.info({ ...turn.identity, stage: 'llm_provider', ...providers.planner.info });
      return { raw: await stage('llm', () => providers.planner.plan(context(state.text), signal)) };
    })
    .addNode('validate_plan', async (state) => {
      active();
      const parsed = ReplyPlanSchema.safeParse(state.raw);
      if (parsed.success) {
        try {
          validateStory(parsed.data, state.text, session.facts);
          return { plan: parsed.data, valid: true };
        } catch (error) {
          if (!(error instanceof AppError)) throw error;
        }
      }
      if (state.repairCount >= config.MAX_SCHEMA_REPAIRS)
        throw new AppError('INVALID_PLAN', 502, '她还没有整理好回应，请换个话题再试。', true);
      return { valid: false };
    })
    .addNode('repair_plan', async (state) => ({
      repairCount: state.repairCount + 1,
      raw: await stage('llm_repair', () =>
        providers.planner.plan(
          context(
            state.text,
            '上次输出未通过 ReplyPlan 结构或场景规则校验。请严格遵守结构与照片许可。',
          ),
          signal,
        ),
      ),
    }))
    .addNode('synthesize_and_publish', async (state) => {
      if (!state.plan) throw new AppError('INVALID_PLAN', 502, '她还没有整理好回应。', true);
      logger.info({
        ...turn.identity,
        stage: 'plan',
        segmentCount: state.plan.segments.length,
        eventCount: state.plan.segments.reduce((sum, segment) => sum + segment.events.length, 0),
        planBytes: Buffer.byteLength(JSON.stringify(state.plan)),
        usage: 'unknown',
      });
      const published: string[] = [];
      let previousPhoto: string | undefined;
      for (const [index, segment] of state.plan.segments.entries()) {
        // At most the current sentence and one successor may be ready. Receipts release pressure.
        const predecessor = published[index - 2];
        if (predecessor)
          await stage('presentation_backpressure', () =>
            sessions.waitForPresentation(session, turn, predecessor),
          );
        active();
        const photoToWait = previousPhoto;
        if (
          segment.events.some((event) => event.type === 'environment') &&
          !session.facts.photo_revealed &&
          photoToWait
        )
          await stage('photo_presentation', () =>
            sessions.waitForPresentation(session, turn, photoToWait),
          );
        const nextTimeout = index > 0 ? new AbortController() : undefined;
        const timer = nextTimeout
          ? setTimeout(
              () =>
                nextTimeout.abort(
                  new AppError(
                    'NEXT_SEGMENT_TIMEOUT',
                    504,
                    '下一句话暂时没有准备好，请再试一次。',
                    true,
                  ),
                ),
              config.NEXT_SEGMENT_TIMEOUT_MS,
            )
          : undefined;
        timer?.unref();
        try {
          const synthesisSignal = nextTimeout
            ? AbortSignal.any([signal, nextTimeout.signal])
            : signal;
          logger.info({ ...turn.identity, stage: 'tts_provider', ...providers.tts.info });
          const audio = await stage('tts', () =>
            abortable(providers.tts.synthesize(segment.text, synthesisSignal), synthesisSignal),
          );
          logger.info({
            ...turn.identity,
            stage: 'tts_result',
            providerRequestId: audio.requestId ?? 'unknown',
          });
          const publication = media.put(session.id, turn.identity.turnId, audio, synthesisSignal);
          // If cancellation wins a store upload race, the late object is never left unowned.
          void publication
            .then(async (asset) => {
              if (synthesisSignal.aborted) await media.delete(asset.assetId);
            })
            .catch(() =>
              logger.info({ ...turn.identity, stage: 'media_cleanup', outcome: 'failed' }),
            );
          const asset = await stage('media_store', () => abortable(publication, synthesisSignal));
          const payload: AudioReadyPayload = {
            segmentId: id(),
            text: segment.text,
            emotion: segment.emotion,
            action: segment.action,
            audioUrl: asset.url,
            events: segment.events
              .filter(
                (event) =>
                  event.type !== 'environment' ||
                  session.facts.photo_revealed ||
                  segment.events.some((candidate) => candidate.type === 'photo'),
              )
              .map((event) => ({ ...event, eventId: id() })),
          };
          sessions.issue(session, turn, payload);
          try {
            await publish({ type: 'audio.ready', payload });
            sessions.firstAudioPublished(turn);
          } catch (error) {
            await media.delete(asset.assetId);
            throw error;
          }
          previousPhoto =
            payload.events.find((event) => event.type === 'photo')?.eventId ?? previousPhoto;
          published.push(payload.segmentId);
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
      await publish({ type: 'reply.done', payload: { segmentCount: state.plan.segments.length } });
      sessions.generated(turn);
      return {};
    })
    .addEdge(START, 'normalize_input')
    .addConditionalEdges('normalize_input', () =>
      input.kind === 'audio' ? 'transcribe' : 'build_context',
    )
    .addEdge('transcribe', 'build_context')
    .addEdge('build_context', 'plan_reply')
    .addEdge('plan_reply', 'validate_plan')
    .addConditionalEdges('validate_plan', (state) =>
      state.valid ? 'synthesize_and_publish' : 'repair_plan',
    )
    .addEdge('repair_plan', 'validate_plan')
    .addEdge('synthesize_and_publish', END)
    .compile();
  await graph.invoke(
    { text: '', raw: null, plan: null, valid: false, repairCount: 0 },
    { signal, recursionLimit: config.LANGGRAPH_RECURSION_LIMIT },
  );
}
