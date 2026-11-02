import { randomUUID } from 'node:crypto';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import {
  ReplyPlanSchema,
  PlannerOutputSchema,
  type AudioReadyPayload,
  type SpeechReadyPayload,
  type ReplyPlan,
  type ServerEvent,
  type StoryInteraction,
  type PresentationEvent,
  type PlannerOutput,
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
import {
  actionConfirmationInput,
  interactionActionId,
} from '../scenario/runtime/action-confirmation.js';

export type TurnInput = { voicePlayback?: boolean } & (
  | { kind: 'media'; media: { kind: 'image-share'; shareId: string; claimId: string } }
  | { kind: 'text'; text: string }
  | { kind: 'audio'; bytes: Uint8Array; mimeType: string }
  | { kind: 'interaction'; interaction: StoryInteraction }
);
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
  mediaDecision: Annotation<PlannerOutput['mediaDecision']>(),
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
  if (turn.mediaShareId && input.kind !== 'media')
    throw new AppError('INVALID_REQUEST', 400, '这次回应只用于展示照片。');
  const origin = session.narrative;
  const active = () => sessions.assertCurrent(session, turn);
  const stage = <T>(name: string, operation: () => Promise<T>) =>
    timed(logger, turn.identity, name, async () => {
      active();
      const value = await abortable(operation(), signal);
      active();
      return value;
    });
  const notAlreadySaid = (suggestion: { draft: string }) =>
    !session.history.some(
      (message) => message.role === 'user' && message.text.trim() === suggestion.draft.trim(),
    );
  const context = async (text: string, repair?: unknown) => {
    const imageCandidate =
      providers.image && !session.imageShares.size ? sessions.imageCandidate(session) : undefined;
    return {
      text,
      facts: Object.entries(session.facts)
        .filter(([, value]) => value)
        .map(([key]) => key),
      history: await trimPlannerHistory([...session.history], config.CONTEXT_HISTORY_TOKENS),
      ...scenario.context(origin, session.history),
      mediaCandidate: providers.image
        ? {
            candidate: imageCandidate
              ? {
                  available: true,
                  title: imageCandidate.title,
                  originLabel: imageCandidate.originLabel,
                  sharingIntention: imageCandidate.introduction,
                  allowedFocus: ['character', 'prop', 'environment'],
                  allowedMood: ['warm', 'playful', 'quiet'],
                  allowedFraming: ['portrait', 'medium', 'detail'],
                }
              : null,
            announced: [...session.imageShares.values()]
              .filter((work) => work.slotConfirmed)
              .map((work) => ({
                phase: work.share.phase,
                originLabel: work.share.originLabel,
                presented: !!work.share.presentedAt,
              })),
            memory: session.imageMemory,
          }
        : undefined,
      ...(repair === undefined ? {} : { repair }),
    };
  };

  const prepareLine = async (
    text: string,
    emotion: AudioReadyPayload['emotion'] = 'relieved',
    action: AudioReadyPayload['action'] = 'none',
    lineSignal: AbortSignal = signal,
  ): Promise<SpeechReadyPayload> => {
    let audioUrl: string | undefined;
    if (input.voicePlayback !== false && providers.tts.info.provider !== 'text-only') {
      const audio = await stage('tts', () =>
        abortable(providers.tts.synthesize(text, lineSignal), lineSignal),
      );
      const publication = media.put(session.id, turn.identity.turnId, audio, lineSignal);
      void publication
        .then((asset) => {
          if (lineSignal.aborted) return media.delete(asset.assetId);
        })
        .catch(() => undefined);
      audioUrl = (await stage('media_store', () => abortable(publication, lineSignal))).url;
    }
    return {
      segmentId: id(),
      text,
      emotion,
      action,
      events: [],
      ...(audioUrl
        ? { audioUrl }
        : {
            captionOnly: true as const,
            ...(input.voicePlayback === false ? { autoAdvance: true as const } : {}),
          }),
    };
  };
  const announceImage = async (work: NonNullable<ReturnType<typeof sessions.reserveImage>>) => {
    const introduction = await prepareLine(work.recipe.introduction);
    active();
    sessions.issue(session, turn, introduction);
    sessions.issueImageSlot(session, turn, work);
    await publish({
      type: 'image.pending',
      payload: {
        share: sessions.imageProjection(work),
        slotEventId: work.slotEventId,
        introduction,
      },
    });
    sessions.firstAudioPublished(turn);
  };
  // An explicit image request uses the current scene recipe, not a guessed LLM utterance.
  if (input.kind === 'interaction' && input.interaction.kind === 'image') {
    active();
    if (input.interaction.revision !== origin.revision)
      throw new AppError('STALE_TURN', 409, '场景已更新，请重新选择生成图片。', true);
    if (!providers.image)
      throw new AppError('INVALID_REQUEST', 400, '当前服务未开启图片生成。', true);
    const work = sessions.reserveImage(
      session,
      turn,
      { focus: 'character', mood: 'warm', framing: 'medium' },
      providers.image.simulated,
      true,
    );
    if (!work)
      throw new AppError(
        'INVALID_REQUEST',
        400,
        '请在可生成图片的场景中操作，已有图片请在原卡片查看。',
        true,
      );
    sessions.imageDecision(session, 'prepare');
    await announceImage(work);
    active();
    await publish({ type: 'reply.done', payload: { segmentCount: 1, suggestions: [] } });
    sessions.generated(turn);
    return;
  }
  // A finite media turn reuses SSE and the scheduler, without creating a user message or GPT call.
  if (input.kind === 'media') {
    const work = sessions.claimImage(session, turn, input.media.shareId, input.media.claimId);
    const introduction = await prepareLine(work.recipe.readyLine);
    sessions.claimImage(session, turn, input.media.shareId, input.media.claimId);
    const imageEventId = id();
    sessions.issueImage(session, turn, work, imageEventId);
    sessions.issue(session, turn, introduction);
    await publish({
      type: 'image.ready',
      payload: {
        shareId: work.share.shareId,
        version: work.share.version,
        imageEventId,
        assetId: work.share.assetId!,
        introduction,
      },
    });
    sessions.firstAudioPublished(turn);
    await publish({
      type: 'reply.done',
      payload: { segmentCount: 1, suggestions: scenario.suggestions?.(session.narrative) ?? [] },
    });
    sessions.generated(turn);
    return;
  }

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
    .addNode('review_interaction', async () => {
      if (input.kind !== 'interaction') return {};
      active();
      // Resolve and validate the exact current choice before asking about character willingness.
      scenario.propose(input.interaction, origin);
      const actionId = interactionActionId(input.interaction);
      const action = scenario.frame(origin).story.actions.find((item) => item.id === actionId);
      if (!action) throw new AppError('INVALID_REQUEST', 400, '这里的选择已经更新。', true);
      const needsConfirmation = !!scenario.actionReview?.(origin, actionId);
      if (needsConfirmation) {
        turn.conversationSnapshot = { revision: origin.revision, location: session.story.location };
        sessions.addUser(session, turn, `[选择：${action.label}]`);
      }
      return { actionId, needsConfirmation, text: needsConfirmation ? action.label : '' };
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
      // A validated story action can also keep/defer/dismiss an existing image share.
      // New user input temporarily pauses delivery until this semantic pass completes.
      sessions.imageDecision(session, state.mediaDecision?.decision);
      const dependencies: string[] = [];
      let audioCount = 0;
      const hasAuthoredSpeech = beats.some((beat) => !!beat.line);
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
        // Only short authored anchors (a greeting, puzzle answer or consent) are spoken here.
        // Ordinary conversation is generated after the actual event has been presented.
        const lines = beat.line ? [beat.line] : [];
        for (const line of lines) {
          const payload = await prepareLine(line.text, line.emotion, line.action);
          sessions.issue(session, turn, payload);
          try {
            await publish(
              'audioUrl' in payload
                ? { type: 'audio.ready', payload }
                : { type: 'text.ready', payload },
            );
          } catch (error) {
            if ('audioUrl' in payload) await media.delete(payload.audioUrl.split('/').at(-1)!);
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
      // Suggestions must describe what was actually presented, not the old cursor.
      const lastTarget = dependencies.at(-1);
      if (lastTarget) {
        await stage('story_presentation', () =>
          sessions.waitForPresentation(session, turn, lastTarget),
        );
        if (turn.targets.get(lastTarget)?.confirmed?.status !== 'presented')
          throw new AppError('MEDIA_FAILED', 502, '场景未完成，已保留最后确认的位置。', true);
      }
      let suggestions: ReplyPlan['suggestions'] = [];
      const latest = scenario.frame(session.narrative);
      if (
        (scenario.canConverse?.(session.narrative) ?? true) &&
        (!latest.story.shot || latest.story.shot.mode === 'shared')
      ) {
        const currentActionId = interactionActionId(intent);
        const action = scenario
          .frame(origin)
          .story.actions.find((item) => item.id === currentActionId);
        const latestContext = scenario.context(session.narrative, session.history);
        let response: ReplyPlan | undefined;
        try {
          for (let attempt = 0; attempt <= config.MAX_SCHEMA_REPAIRS; attempt++) {
            const raw = await stage(
              hasAuthoredSpeech ? 'story_suggestions' : 'story_reply',
              async () =>
                providers.planner.plan(
                  {
                    ...latestContext,
                    systemPrompt:
                      latestContext.systemPrompt +
                      (hasAuthoredSpeech
                        ? '\n本次只为刚刚实际说完的回应生成玩家下一句推荐。segments必须为空。'
                        : '\n刚才的场景事件已经实际呈现。请依据最新真实历史、当前玩家原话与确认后的场景，生成一句自然承接（必要时两句），并同时生成贴合这次回应的玩家推荐。先接住玩家实际的问题或意图，不念剧本，不为切换场景重新打招呼，不编之前没有谈过的话。') +
                      '\nactionId和actionRequest必须为null，events必须为空；不得发起另一项动作。当前章是可停留的交流空间，不是待逐条完成的问题清单。选择标签不是玩家说出口的话。',
                    scene: {
                      ...(latestContext.scene && typeof latestContext.scene === 'object'
                        ? latestContext.scene
                        : {}),
                      completedInteraction: {
                        id: currentActionId,
                        label: action?.label ?? '',
                        source: input.kind === 'interaction' ? 'choice' : 'speech',
                      },
                    },
                    text: input.kind === 'interaction' ? '' : state.text,
                    facts: Object.entries(session.facts)
                      .filter(([, value]) => value)
                      .map(([key]) => key),
                    history: await trimPlannerHistory(
                      [...session.history],
                      config.CONTEXT_HISTORY_TOKENS,
                    ),
                    ...(attempt
                      ? { repair: '输出必须是无动作的自然回应和推荐，不能再提议执行刚完成的事件。' }
                      : {}),
                  },
                  signal,
                ),
            );
            const generated = PlannerOutputSchema.safeParse(raw);
            if (
              generated.success &&
              !generated.data.actionId &&
              !generated.data.actionRequest &&
              (hasAuthoredSpeech
                ? generated.data.segments.length === 0
                : generated.data.segments.length > 0)
            ) {
              suggestions = filterSuggestions(
                generated.data.suggestions,
                latest.story.actions,
                latest.story.phase,
                latest.recommendationPolicy,
              ).filter((item) => item.draft.trim() !== state.text.trim() && notAlreadySaid(item));
              if (!hasAuthoredSpeech) {
                response = ReplyPlanSchema.parse({
                  segments: generated.data.segments,
                  suggestions,
                });
                scenario.validate(response);
              }
              break;
            }
            if (attempt === config.MAX_SCHEMA_REPAIRS && !hasAuthoredSpeech)
              throw new AppError(
                'INVALID_PLAN',
                502,
                '刚才的行动已完成，回应暂时没有准备好，可以接着聊。',
                true,
              );
          }
        } catch (error) {
          if (signal.aborted) throw error;
          active(); // A late failed request must not finish a superseded turn.
          if (!hasAuthoredSpeech) throw error;
          logger.info({ ...turn.identity, stage: 'story_suggestions', outcome: 'unavailable' });
        }
        if (response) {
          const spoken: string[] = [];
          for (const line of response.segments) {
            const predecessor = spoken.at(-1);
            if (predecessor) {
              await stage('story_reply_presentation', () =>
                sessions.waitForPresentation(session, turn, predecessor),
              );
              if (turn.targets.get(predecessor)?.confirmed?.status !== 'presented')
                throw new AppError('MEDIA_FAILED', 502, '回应未完成，已保留刚才确认的场景。', true);
            }
            active();
            const payload = await prepareLine(line.text, line.emotion, line.action);
            sessions.issue(session, turn, payload);
            try {
              await publish(
                'audioUrl' in payload
                  ? { type: 'audio.ready', payload }
                  : { type: 'text.ready', payload },
              );
            } catch (error) {
              if ('audioUrl' in payload) await media.delete(payload.audioUrl.split('/').at(-1)!);
              throw error;
            }
            spoken.push(payload.segmentId);
            audioCount++;
          }
        }
      }
      active();
      await publish({ type: 'reply.done', payload: { segmentCount: audioCount, suggestions } });
      sessions.generated(turn);
      return {};
    })
    .addNode('build_context', async (state) => {
      if (scenario.canConverse && !scenario.canConverse(session.narrative))
        throw new AppError('INVALID_REQUEST', 400, '尚未开始交谈，请先选择当前场景的行动。', true);
      const shot = scenario.frame(session.narrative).story.shot;
      if (shot && shot.mode !== 'shared')
        throw new AppError(
          'INVALID_REQUEST',
          400,
          '这是独处或留白片段，请选择等候、继续或结束。',
          true,
        );
      turn.conversationSnapshot = { revision: origin.revision, location: session.story.location };
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
        if (action)
          return {
            actionId: action.id,
            needsConfirmation: action.explicit || !!scenario.actionReview?.(origin, action.id),
            plan: null,
            mediaDecision: decision.data.mediaDecision ?? null,
            valid: true,
          };
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
              ).filter((item) => item.draft.trim() !== state.text.trim() && notAlreadySaid(item)),
            }
          : state.raw;
        const parsed = ReplyPlanSchema.safeParse(raw);
        if (parsed.success) {
          try {
            scenario.validate(parsed.data);
            return {
              plan: parsed.data,
              actionId: null,
              valid: true,
              mediaDecision:
                decision.success && !state.conversationOnly ? decision.data.mediaDecision : null,
            };
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
        providers.planner.plan(
          actionConfirmationInput(await context(state.text), action, {
            characterCondition: scenario.actionReview?.(origin, action.id),
            source: input.kind === 'interaction' ? 'choice' : 'speech',
          }),
          signal,
        ),
      );
      if (session.narrative.revision !== origin.revision)
        throw new AppError('STALE_TURN', 409, '场景已更新，请重新表达这次的想法。', true);
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
      sessions.imageDecision(session, state.mediaDecision?.decision);
      const work =
        providers.image && state.mediaDecision?.decision === 'prepare' && state.mediaDecision.intent
          ? sessions.reserveImage(
              session,
              turn,
              state.mediaDecision.intent,
              providers.image.simulated,
            )
          : undefined;
      const segments = work ? state.plan.segments.slice(0, 3) : state.plan.segments;
      const published: string[] = [];
      for (const [index, segment] of segments.entries()) {
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
          const payload: SpeechReadyPayload = {
            ...(await prepareLine(segment.text, segment.emotion, segment.action, synthesisSignal)),
            events: segment.events.map((event) => ({ ...event, eventId: id() })),
          };
          sessions.issue(session, turn, payload);
          try {
            await publish(
              'audioUrl' in payload
                ? { type: 'audio.ready', payload }
                : { type: 'text.ready', payload },
            );
            sessions.firstAudioPublished(turn);
          } catch (error) {
            if ('audioUrl' in payload) await media.delete(payload.audioUrl.split('/').at(-1)!);
            throw error;
          }
          published.push(payload.segmentId);
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
      if (work) {
        await announceImage(work);
      }
      await publish({
        type: 'reply.done',
        payload: {
          segmentCount: segments.length + (work ? 1 : 0),
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
          ? 'review_interaction'
          : 'build_context',
    )
    .addConditionalEdges('review_interaction', (state) =>
      state.needsConfirmation ? 'confirm_action' : 'story_interaction',
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
      mediaDecision: null,
    },
    { signal, recursionLimit: config.LANGGRAPH_RECURSION_LIMIT },
  );
}
