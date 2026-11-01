import { randomUUID } from 'node:crypto';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import {
  ReplyPlanSchema,
  PlannerOutputSchema,
  type AudioReadyPayload,
  type ReplyPlan,
  type ServerEvent,
  type StoryInteraction,
  type PresentationEvent,
} from '@mira/protocol';
import type { Config } from '../config/index.js';
import type { ProviderSet } from '../providers/index.js';
import type { MediaService } from '../media/index.js';
import { AppError } from '../http/errors.js';
import { transcribeRecording } from './transcription.js';
import { abortable } from './abortable.js';
import { timed, type StageLogger } from '../observability/stages.js';
import type { ScenarioDefinition } from '../scenario/ports.js';
import {
  authorizedPlannerAction,
  filterSuggestions,
  trimPlannerHistory,
} from '../scenario/runtime/context.js';
import type { Session, SessionManager, Turn } from '../sessions/manager.js';
import { actionConfirmationInput } from '../scenario/runtime/action-confirmation.js';

export type TurnInput =
  | { kind: 'text'; text: string }
  | { kind: 'audio'; bytes: Uint8Array; mimeType: string }
  | { kind: 'interaction'; interaction: StoryInteraction };
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
  scenario: ScenarioDefinition;
  id?: () => string;
}
const GraphState = Annotation.Root({
  text: Annotation<string>(),
  raw: Annotation<unknown>(),
  plan: Annotation<ReplyPlan | null>(),
  valid: Annotation<boolean>(),
  repairCount: Annotation<number>(),
  actionId: Annotation<string | null>(),
  needsConfirmation: Annotation<boolean>(),
  conversationOnly: Annotation<boolean>(),
});

/** A non-cooperative upstream can finish later, but cannot keep the graph alive or publish. */
export { abortable } from './abortable.js';

export async function runConversation(
  dependencies: ConversationDependencies,
  session: Session,
  turn: Turn,
  input: TurnInput,
  publish: Publish,
): Promise<void> {
  const { config, providers, media, sessions, logger, scenario } = dependencies;
  const id = dependencies.id ?? randomUUID;
  const signal = turn.abort.signal;
  const origin = session.narrative;
  const active = () => sessions.assertCurrent(session, turn);
  const stage = <T>(name: string, operation: () => Promise<T>) =>
    timed(logger, turn.identity, name, async () => {
      active();
      const value = await abortable(operation(), signal);
      active();
      return value;
    });
  const context = async (text: string, repair?: unknown) => ({
    text,
    facts: Object.entries(session.facts)
      .filter(([, value]) => value)
      .map(([key]) => key),
    history: await trimPlannerHistory([...session.history], config.CONTEXT_HISTORY_TOKENS),
    ...scenario.context(origin, session.history),
    ...(repair === undefined ? {} : { repair }),
  });

  const graph = new StateGraph(GraphState)
    .addNode('normalize_input', async () => {
      active();
      return {
        text: input.kind === 'text' ? input.text.trim() : '',
        repairCount: 0,
        actionId: null,
        needsConfirmation: false,
        conversationOnly: false,
        valid: false,
        plan: null,
      };
    })
    .addNode('transcribe', async () => {
      if (input.kind !== 'audio') return {};
      const transcription = await transcribeRecording(dependencies, session, turn, input);
      const text = transcription.text;
      await publish({
        type: 'input.transcribed',
        payload: { text, simulated: transcription.simulated },
      });
      return { text };
    })
    .addNode('story_interaction', async (state) => {
      active();
      if (session.narrative.revision !== origin.revision)
        throw new AppError('STALE_TURN', 409, '刚才的场景已更新，请再说一次你的想法。', true);
      const intent =
        input.kind === 'interaction'
          ? input.interaction
          : state.actionId
            ? { kind: 'action' as const, actionId: state.actionId, revision: origin.revision }
            : null;
      if (!intent) throw new AppError('INVALID_REQUEST', 400, '没有识别到场景操作。');
      const beats = scenario.propose(intent, session.narrative);
      const dependencies: string[] = [];
      let audioCount = 0;
      for (const beat of beats) {
        active();
        if (dependencies.length) {
          const previous = dependencies.at(-1)!;
          await stage('story_presentation', () =>
            sessions.waitForPresentation(session, turn, previous),
          );
          if (turn.targets.get(previous)?.confirmed?.status !== 'presented')
            throw new AppError('MEDIA_FAILED', 502, '场景未完成，已保留最后确认的位置。', true);
        }
        if (beat.line) {
          const audio = await stage('tts', () => providers.tts.synthesize(beat.line!.text, signal));
          const upload = media.put(session.id, turn.identity.turnId, audio, signal);
          void upload
            .then(async (asset) => {
              if (signal.aborted) await media.delete(asset.assetId);
            })
            .catch(() => undefined);
          const asset = await stage('media_store', () => abortable(upload, signal));
          const payload: AudioReadyPayload = {
            segmentId: id(),
            text: beat.line.text,
            audioUrl: asset.url,
            emotion: beat.line.emotion,
            action: beat.line.action,
            events: [],
          };
          sessions.issue(session, turn, payload);
          try {
            await publish({ type: 'audio.ready', payload });
          } catch (error) {
            await media.delete(asset.assetId);
            throw error;
          }
          dependencies.push(payload.segmentId);
          audioCount++;
        }
        const event = { ...beat.event, eventId: id() } as PresentationEvent;
        sessions.issueEvents(session, turn, [event], true, dependencies, beat.checkpoint);
        await publish({
          type: 'presentation.ready',
          payload: {
            presentationId: id(),
            caption: beat.caption,
            events: [event],
            storyAfter: beat.frame.story,
            factsAfter: beat.frame.facts,
            environmentAfter: beat.frame.presentation?.environment,
          },
        });
        dependencies.push(event.eventId);
        sessions.firstAudioPublished(turn);
      }
      await publish({
        type: 'reply.done',
        payload: {
          segmentCount: audioCount,
          suggestions: scenario.suggestions?.(beats.at(-1)?.checkpoint ?? session.narrative) ?? [],
        },
      });
      sessions.generated(turn);
      return {};
    })
    .addNode('build_context', async (state) => {
      const shot = scenario.frame(session.narrative).story.shot;
      if (shot && shot.mode !== 'shared')
        throw new AppError(
          'INVALID_REQUEST',
          400,
          '这是独处或留白片段，请选择等候、继续或结束。',
          true,
        );
      sessions.addUser(session, turn, state.text);
      return {};
    })
    .addNode('plan_reply', async (state) => {
      logger.info({ ...turn.identity, stage: 'llm_provider', ...providers.planner.info });
      return {
        raw: await stage('llm', async () =>
          providers.planner.plan(await context(state.text), signal),
        ),
      };
    })
    .addNode('validate_plan', async (state) => {
      active();
      const decision = PlannerOutputSchema.safeParse(state.raw);
      if (decision.success && decision.data.actionId && !state.conversationOnly) {
        const action = authorizedPlannerAction(
          decision.data,
          state.text,
          scenario.frame(origin).story.actions,
        );
        if (action) {
          return {
            actionId: action.id,
            needsConfirmation: action.explicit,
            plan: null,
            valid: true,
          };
        }
      } else if (!decision.success || (!decision.data.actionId && !decision.data.actionRequest)) {
        const frame = scenario.frame(session.narrative);
        const raw = decision.success
          ? {
              segments: decision.data.segments,
              suggestions: filterSuggestions(
                decision.data.suggestions,
                frame.story.actions,
                frame.story.phase,
                frame.recommendationPolicy,
                scenario.suggestions?.(session.narrative),
              ),
            }
          : state.raw;
        const parsed = ReplyPlanSchema.safeParse(raw);
        if (parsed.success) {
          try {
            scenario.validate(parsed.data);
            return { plan: parsed.data, actionId: null, valid: true };
          } catch (error) {
            if (!(error instanceof AppError)) throw error;
          }
        }
      }
      if (state.repairCount >= config.MAX_SCHEMA_REPAIRS)
        throw new AppError('INVALID_PLAN', 502, '角色还没有准备好回复，请换个话题再试。', true);
      return { valid: false };
    })
    .addNode('confirm_action', async (state) => {
      active();
      const actions = scenario.frame(origin).story.actions;
      const action = actions.find((item) => item.id === state.actionId);
      if (!action) throw new AppError('INVALID_PLAN', 502, '这个选择暂时无法执行。', true);
      const raw = await stage('llm_action_confirmation', async () =>
        providers.planner.plan(actionConfirmationInput(await context(state.text), action), signal),
      );
      const reviewed = PlannerOutputSchema.safeParse(raw);
      if (reviewed.success && authorizedPlannerAction(reviewed.data, state.text, [action]))
        return { needsConfirmation: false };
      // Re-enter validation with actions disabled. A refusal/clarification is ordinary dialogue.
      return {
        raw,
        actionId: null,
        needsConfirmation: false,
        conversationOnly: true,
        valid: false,
      };
    })
    .addNode('repair_plan', async (state) => ({
      repairCount: state.repairCount + 1,
      raw: await stage('llm_repair', async () =>
        providers.planner.plan(
          {
            ...(await context(
              state.text,
              '上次输出未通过结构、当前动作或用户同意校验。不要推测同意；如果意图不明确，请用角色的一句话澄清，actionId和actionRequest设为null。',
            )),
            ...(state.conversationOnly ? { allowedActions: [] } : {}),
          },
          signal,
        ),
      ),
    }))
    .addNode('synthesize_and_publish', async (state) => {
      if (!state.plan) throw new AppError('INVALID_PLAN', 502, '角色还没有准备好回复。', true);
      logger.info({
        ...turn.identity,
        stage: 'plan',
        segmentCount: state.plan.segments.length,
        eventCount: state.plan.segments.reduce((sum, segment) => sum + segment.events.length, 0),
        planBytes: Buffer.byteLength(JSON.stringify(state.plan)),
        usage: 'unknown',
      });
      const published: string[] = [];
      for (const [index, segment] of state.plan.segments.entries()) {
        // At most the current sentence and one successor may be ready. Receipts release pressure.
        const predecessor = published[index - 2];
        if (predecessor)
          await stage('presentation_backpressure', () =>
            sessions.waitForPresentation(session, turn, predecessor),
          );
        active();
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
            events: segment.events.map((event) => ({ ...event, eventId: id() })),
          };
          sessions.issue(session, turn, payload);
          try {
            await publish({ type: 'audio.ready', payload });
            sessions.firstAudioPublished(turn);
          } catch (error) {
            await media.delete(asset.assetId);
            throw error;
          }
          published.push(payload.segmentId);
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
      await publish({
        type: 'reply.done',
        payload: {
          segmentCount: state.plan.segments.length,
          suggestions: state.plan.suggestions,
        },
      });
      sessions.generated(turn);
      return {};
    })
    .addEdge(START, 'normalize_input')
    .addConditionalEdges('normalize_input', () =>
      input.kind === 'audio'
        ? 'transcribe'
        : input.kind === 'interaction'
          ? 'story_interaction'
          : 'build_context',
    )
    .addConditionalEdges('transcribe', () => 'build_context')
    .addEdge('story_interaction', END)
    .addEdge('build_context', 'plan_reply')
    .addEdge('plan_reply', 'validate_plan')
    .addConditionalEdges('validate_plan', (state) =>
      state.valid
        ? state.actionId
          ? state.needsConfirmation
            ? 'confirm_action'
            : 'story_interaction'
          : 'synthesize_and_publish'
        : 'repair_plan',
    )
    .addConditionalEdges('confirm_action', (state) =>
      state.actionId ? 'story_interaction' : 'validate_plan',
    )
    .addEdge('repair_plan', 'validate_plan')
    .addEdge('synthesize_and_publish', END)
    .compile();
  await graph.invoke(
    {
      text: '',
      raw: null,
      plan: null,
      valid: false,
      repairCount: 0,
      actionId: null,
      needsConfirmation: false,
      conversationOnly: false,
    },
    { signal, recursionLimit: config.LANGGRAPH_RECURSION_LIMIT },
  );
}
