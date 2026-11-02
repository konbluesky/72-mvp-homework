import { z } from 'zod';
import {
  StoryStateSchema,
  ContentIdSchema,
  StoryInteractionSchema,
  LocationEventSchema,
  PropEventSchema,
  AmbienceEventSchema,
  EndingEventSchema,
  BeatEventSchema,
} from './story.js';
export * from './story.js';

/**
 * 前后端共用的数据契约：Zod 校验网络边界，TypeScript 类型从 schema 推导。
 * 按“身份 -> 会话 -> 计划 -> 下发 -> 回执 -> 命令 -> 传输”阅读。
 * 这里只约束数据形状与限额；鉴权、轮次仲裁、剧情前置由服务端执行。
 * 演出字段是业务意图，不绑定具体 Provider 或角色渲染技术。
 * 设计依据：docs/contracts/README.md、docs/architecture/decisions.md。
 */

// 基础：标识、轮次身份与业务状态

/** 业务事件版本；未知版本由客户端拒绝，避免按旧含义执行。 */
export const SCHEMA_VERSION = 4 as const;

/** 不透明标识，只允许短字符集；不承载路径、URL 或权限。 */
export const IdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);

/** 异步副作用的归属标识。generation 在会话内递增，turnId 标识具体轮次。 */
export const TurnIdentitySchema = z
  .object({ sessionId: IdSchema, generation: z.number().int().positive(), turnId: IdSchema })
  .strict();

export type TurnIdentity = z.infer<typeof TurnIdentitySchema>;

/** 下载、解码、动画回调执行前核对完整身份；身份缺失也视为失效。 */
export function sameTurn(a: TurnIdentity | undefined, b: TurnIdentity | undefined): boolean {
  return (
    !!a &&
    !!b &&
    a.sessionId === b.sessionId &&
    a.turnId === b.turnId &&
    a.generation === b.generation
  );
}

/** 采集开始才 listening，音频开始才 speaking；授权等待和字幕降级另行表达。 */
export const InteractionSchema = z.enum(['idle', 'listening', 'thinking', 'speaking']);

export type Interaction = z.infer<typeof InteractionSchema>;

/** 情绪与交互状态独立，同一种情绪可处于倾听或说话。 */
export const EmotionSchema = z.enum(['guarded', 'curious', 'relieved']);

export type Emotion = z.infer<typeof EmotionSchema>;

/** 一次性业务动作，由渲染适配器解释；不暴露模型文件或运行时参数。 */
export const ActionSchema = z.enum([
  'none',
  'lookWindow',
  'offerPhoto',
  'acknowledge',
  'focusProp',
]);

export type Action = z.infer<typeof ActionSchema>;

/** 场景声明的环境预设 ID；跨轮保留已确认变化。 */
export const EnvironmentSchema = ContentIdSchema;

// 会话：能力、已确认场景与上下文

/** 服务端由合法呈现回执提交的剧情事实；计划下发不等于事实成立。 */
export const FactsSchema = z
  .record(ContentIdSchema, z.boolean())
  .refine((facts) => Object.keys(facts).length <= 64, 'Too many public facts');

export type Facts = z.infer<typeof FactsSchema>;

/** 单角色场景快照：身份、环境和事实，不携带播放器或渲染实例。 */
export const SceneSchema = z
  .object({
    character: ContentIdSchema,
    scenario: z
      .object({ id: ContentIdSchema, version: z.string().min(1).max(80) })
      .strict()
      .optional(),
    environment: EnvironmentSchema,
    facts: FactsSchema,
    story: StoryStateSchema.optional(),
  })
  .strict();

/** 实际 Provider 组合支持的入口；UI 按能力开放录音，不按 mock/live 猜测。 */
export const CapabilitiesSchema = z.object({ voiceInput: z.boolean() }).strict();

export const CreateSessionSchema = z
  .object({
    entry: z.enum(['story', 'conversation']).default('story'),
    // Explicit restart: authenticate this existing session before replacing it.
    replaceSessionId: IdSchema.optional(),
  })
  .strict();

/** 玩家发言；服务端可绑定当前合法动作。点击才提交，候选生成不授权执行或提交事实。 */
export const ReplySuggestionSchema = z
  .object({
    label: z.string().trim().min(1).max(20),
    draft: z.string().trim().min(1).max(120),
    interaction: StoryInteractionSchema.optional(),
  })
  .strict();

export type ReplySuggestion = z.infer<typeof ReplySuggestionSchema>;
export const ReplySuggestionsSchema = z.array(ReplySuggestionSchema).max(3);

/** 故事包提供的初始文字与下一句；不是已播放音频，不产生呈现回执。 */
export const SessionOpeningSchema = z
  .object({
    text: z.string().trim().min(1).max(160),
    revision: z.number().int().nonnegative(),
    suggestions: ReplySuggestionsSchema,
  })
  .strict();
export type SessionOpening = z.infer<typeof SessionOpeningSchema>;

/** null 表示不按时间过期；有限有效期使用 Unix 毫秒。 */
export const SessionExpirySchema = z.number().int().positive().nullable();

/** 创建匿名会话的响应。会话凭证可用于浏览器刷新恢复，后续仅以鉴权头发送。 */
export const SessionCreatedSchema = z.object({
  sessionId: IdSchema,
  sessionToken: z.string().min(32),
  expiresAt: SessionExpirySchema,
  mode: z.enum(['mock', 'live']),
  capabilities: CapabilitiesSchema,
  scene: SceneSchema,
  opening: SessionOpeningSchema.optional(),
});

export type SessionCreated = z.infer<typeof SessionCreatedSchema>;

/** 消息与执行尝试分离；完成只由全部成功呈现回执确认。 */
export const MessageAttemptSchema = TurnIdentitySchema.extend({
  messageId: IdSchema,
  status: z.enum(['pending', 'completed', 'failed', 'interrupted']),
  presented: z.boolean(),
  retryable: z.boolean(),
  error: z.string().max(240),
}).strict();
export type MessageAttempt = z.infer<typeof MessageAttemptSchema>;

/** Image sharing is a session capability; provider details remain private. */
export const MediaVisualIntentSchema = z
  .object({
    focus: z.enum(['character', 'prop', 'environment']),
    mood: z.enum(['warm', 'playful', 'quiet']),
    framing: z.enum(['portrait', 'medium', 'detail']),
  })
  .strict();
export type MediaVisualIntent = z.infer<typeof MediaVisualIntentSchema>;
export const ImageShareSchema = z
  .object({
    shareId: IdSchema,
    attemptId: IdSchema,
    version: z.number().int().positive(),
    phase: z.enum([
      'preparing',
      'submit_unknown',
      'ready',
      'presented',
      'failed',
      'cancelled',
      'expired',
    ]),
    originLabel: z.string().min(1).max(100),
    title: z.string().min(1).max(80),
    width: z.number().int().min(64).max(4096),
    height: z.number().int().min(64).max(4096),
    expiresAt: z.number().int().positive(),
    announcedAt: z.number().int().positive(),
    presentedAt: z.number().int().positive().optional(),
    assetId: IdSchema.optional(),
    simulated: z.boolean(),
    canRetryGeneration: z.boolean(),
    longWait: z.boolean(),
    reason: z
      .enum(['generation_failed', 'invalid_image', 'deadline', 'cancelled', 'session_ended'])
      .optional(),
  })
  .strict();
export type ImageShare = z.infer<typeof ImageShareSchema>;
export const ImageShareParamsSchema = RouteImageParams();
function RouteImageParams() {
  return z.object({ id: IdSchema, shareId: IdSchema }).strict();
}
export const RetryImageShareSchema = z
  .object({ requestId: IdSchema, expectedVersion: z.number().int().positive() })
  .strict();
export const MediaPresentationSchema = z
  .object({
    purpose: z.literal('media-share'),
    expectedGeneration: z.number().int().nonnegative(),
    shareId: IdSchema,
    expectedShareVersion: z.number().int().positive(),
  })
  .strict();
export const MediaInputSchema = z
  .object({
    generation: z.number().int().positive(),
    inputId: IdSchema,
    media: z
      .object({ kind: z.literal('image-share'), shareId: IdSchema, claimId: IdSchema })
      .strict(),
  })
  .strict();

/** 重连时查询已确认状态，不重播旧事件；history 不包含未呈现的助手计划。 */
export const SessionSnapshotSchema = z.object({
  sessionId: IdSchema,
  // 0 表示会话尚未开始首轮。
  generation: z.number().int().nonnegative(),
  capabilities: CapabilitiesSchema,
  scene: SceneSchema,
  messageAttempts: z.array(MessageAttemptSchema).max(100).optional(),
  imageShares: z.array(ImageShareSchema).max(1).optional(),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        text: z.string(),
        mode: z.enum(['audio', 'text']).optional(),
      }),
    )
    .max(40),
});

// 回复计划：模型只提议内容与白名单演出

/** 图片/环境呈现能力的结构；当前规划器禁止生成世界事件，许可由场景校验。 */
export const PlanEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('photo'), resourceId: ContentIdSchema }).strict(),
  z.object({ type: z.literal('environment'), environment: EnvironmentSchema }).strict(),
]);

/** 一句台词及同步演出意图；同一 text 用于语音和字幕，避免内容分叉。 */
export const PlanSegmentSchema = z
  .object({
    text: z.string().trim().min(1).max(160),
    emotion: EmotionSchema,
    action: ActionSchema,
    events: z.array(PlanEventSchema).max(2),
  })
  .strict();

export type PlanSegment = z.infer<typeof PlanSegmentSchema>;

/** 单轮 proposed 计划；限制句数、句长和事件数，约束生成与播放资源。 */
export const ReplyPlanSchema = z
  .object({
    segments: z.array(PlanSegmentSchema).min(1).max(4),
    suggestions: ReplySuggestionsSchema,
  })
  .strict();

export type ReplyPlan = z.infer<typeof ReplyPlanSchema>;

/** Private planner contract: normal conversation or a current, non-secret action suggestion. */
export const PlannerOutputSchema = z
  .object({
    segments: z
      .array(
        PlanSegmentSchema.extend({
          events: z.array(PlanEventSchema).max(0),
          action: ActionSchema.exclude(['offerPhoto']),
        }),
      )
      .max(4),
    suggestions: z
      .array(
        ReplySuggestionSchema.omit({ interaction: true })
          .extend({
            kind: z.enum(['chat', 'explore', 'decision']),
            relatedActionId: z.string().max(80).nullable(),
          })
          .strict(),
      )
      .max(3),
    mediaDecision: z
      .object({
        decision: z.enum(['prepare', 'defer', 'dismiss', 'keep']),
        intent: MediaVisualIntentSchema.nullable(),
      })
      .strict()
      .nullable()
      .optional(),
    // Whole current input as evidence; confirmed intent is required before any story action.
    actionRequest: z
      .object({
        quote: z.string().trim().min(1).max(1000),
        confirmed: z.boolean(),
      })
      .strict()
      .nullable(),
    actionId: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9-]+$/)
      .nullable(),
  })
  .strict();

export type PlannerOutput = z.infer<typeof PlannerOutputSchema>;

// 下发内容：服务端赋予可追踪的呈现身份

/** 从计划转换的待呈现事件；eventId 由服务端生成，供视觉成功/失败回执引用。 */
export const PresentationEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      eventId: IdSchema,
      type: z.literal('photo'),
      resourceId: ContentIdSchema,
    })
    .strict(),
  z
    .object({
      eventId: IdSchema,
      type: z.literal('environment'),
      environment: EnvironmentSchema,
    })
    .strict(),
  LocationEventSchema.extend({ eventId: IdSchema }).strict(),
  PropEventSchema.extend({ eventId: IdSchema }).strict(),
  AmbienceEventSchema.extend({ eventId: IdSchema }).strict(),
  EndingEventSchema.extend({ eventId: IdSchema }).strict(),
  BeatEventSchema.extend({ eventId: IdSchema }).strict(),
]);

export type PresentationEvent = z.infer<typeof PresentationEventSchema>;

/** 一句音频已可下载；尚未播放。客户端按轮次校验后，由唯一调度器安排字幕和演出。 */
export const AudioReadyPayloadSchema = z
  .object({
    segmentId: IdSchema,
    text: PlanSegmentSchema.shape.text,
    // 仅允许鉴权媒体接口的相对路径，不接收模型指定的外部 URL。
    audioUrl: z.string().regex(/^\/api\/media\/[a-zA-Z0-9_-]+$/),
    emotion: EmotionSchema,
    action: ActionSchema,
    events: z.array(PresentationEventSchema).max(2),
  })
  .strict();

export type AudioReadyPayload = z.infer<typeof AudioReadyPayloadSchema>;
/** Explicit caption-only mode for an offline session; never masquerades as played audio. */
export const CaptionReadyPayloadSchema = AudioReadyPayloadSchema.omit({ audioUrl: true })
  .extend({ captionOnly: z.literal(true) })
  .strict();
export type SpeechReadyPayload = AudioReadyPayload | z.infer<typeof CaptionReadyPayloadSchema>;
export const SpeechReadyPayloadSchema = z.union([
  AudioReadyPayloadSchema,
  CaptionReadyPayloadSchema,
]);

export const PresentationReadyPayloadSchema = z
  .object({
    presentationId: IdSchema,
    caption: z.string().max(240),
    events: z.array(PresentationEventSchema).min(1).max(8),
    storyAfter: StoryStateSchema.optional(),
    factsAfter: FactsSchema.optional(),
    environmentAfter: EnvironmentSchema.optional(),
  })
  .strict();
export type PresentationReadyPayload = z.infer<typeof PresentationReadyPayloadSchema>;

const IntroductionPayloadSchema = z.union([
  AudioReadyPayloadSchema.extend({ events: z.array(PresentationEventSchema).max(0) }).strict(),
  CaptionReadyPayloadSchema.extend({ events: z.array(PresentationEventSchema).max(0) }).strict(),
]);
export const ImagePendingPayloadSchema = z
  .object({
    share: ImageShareSchema,
    slotEventId: IdSchema,
    introduction: IntroductionPayloadSchema,
  })
  .strict();
export type ImagePendingPayload = z.infer<typeof ImagePendingPayloadSchema>;
export const ImageReadyPayloadSchema = z
  .object({
    shareId: IdSchema,
    version: z.number().int().positive(),
    imageEventId: IdSchema,
    assetId: IdSchema,
    introduction: IntroductionPayloadSchema,
  })
  .strict();
export type ImageReadyPayload = z.infer<typeof ImageReadyPayloadSchema>;

// 呈现回执：实际发生后，才能确认事实

/**
 * 单个片段或事件的呈现结果；服务端核对确实下发过的目标后，幂等提交。
 *
 * audio.ready.segmentId --------> targetId (segment)
 * audio.ready.events[].eventId -> targetId (photo / environment)
 *
 * 句子播完不能代替照片可见；failed 只记录失败，不提交对应剧情事实。
 */
export const ReceiptSchema = TurnIdentitySchema.extend({
  receiptId: IdSchema,
  // 指向下发的片段或视觉事件，不是 SSE 帧的 eventId。
  targetId: IdSchema,
  kind: z.enum([
    'segment',
    'image-slot',
    'image',
    'photo',
    'environment',
    'location',
    'prop',
    'ambience',
    'ending',
    'beat',
  ]),
  status: z.enum(['presented', 'failed']),
  // 句子用 audio 标记播完、text 标记字幕确认；视觉事件无需填写。
  mode: z.enum(['audio', 'text']).optional(),
}).strict();

export type Receipt = z.infer<typeof ReceiptSchema>;

/** 打断时冻结本地最终回执，随 cancel 或下一次 begin 补交；迟到回调不得扩充。 */
export const FrozenTurnSchema = z
  .object({
    generation: z.number().int().positive(),
    turnId: IdSchema,
    receipts: z.array(ReceiptSchema).max(32),
  })
  .strict();

export type FrozenTurn = z.infer<typeof FrozenTurnSchema>;

/** 累计重发尚未获确认的回执；已获确认的历史结果仍保留在冻结快照中。 */
export const ReceiptsRequestSchema = z
  .object({ receipts: z.array(ReceiptSchema).max(128) })
  .strict();

/** 确认已接收的 receiptId，供客户端清理待重发队列；不等于所有目标都呈现成功。 */
export const ReceiptsResponseSchema = z.object({ acknowledged: z.array(IdSchema) });

// 轮次命令：先确认 begin，再提交输入

/** 原子合并旧回执/冻结快照，再推进有效轮次并构造新上下文，避免快速多轮丢事实。 */
export const BeginTurnSchema = z
  .object({
    generation: z.number().int().positive(),
    turnId: IdSchema,
    mediaPresentation: MediaPresentationSchema.optional(),
    // 重试保留消息 ID，每次执行使用新的 turnId/generation。
    messageId: IdSchema.optional(),
    receipts: z.array(ReceiptSchema).max(128).default([]),
    frozenTurns: z.array(FrozenTurnSchema).max(8).default([]),
  })
  .strict();

/** 同代同 ID 可幂等查询；completed 只表示生成结束，不能据此认定已听完。 */
export const BeginTurnResponseSchema = TurnIdentitySchema.extend({
  status: z.enum(['begun', 'running', 'completed', 'cancelled']),
  acknowledged: z.array(IdSchema),
  claimId: IdSchema.optional(),
});

/** begin 确认后的文字输入；路由携带 sessionId/turnId，正文补充 generation。 */
export const TextInputSchema = z
  .object({
    generation: z.number().int().positive(),
    // 输入幂等键；同一轮次重试时须保持标识和内容一致。
    inputId: IdSchema,
    text: z.string().trim().min(1).max(1000),
  })
  .strict();

export const InteractionInputSchema = z
  .object({
    generation: z.number().int().positive(),
    inputId: IdSchema,
    interaction: StoryInteractionSchema,
  })
  .strict();
export const JsonInputSchema = z.union([TextInputSchema, InteractionInputSchema, MediaInputSchema]);

/** multipart 的 metadata 字段；音频另用 audio 文件上传，不放入 JSON/SSE。 */
export const AudioInputMetadataSchema = z
  .object({
    generation: z.number().int().positive(),
    // 输入幂等键；同一轮次重试时须保持标识和内容一致。
    inputId: IdSchema,
    // 客户端申报时长；服务端仍须解码验证真实时长、格式和大小。
    durationMs: z.number().min(200).max(15000),
  })
  .strict();

/** 仅识别的语音草稿；不写入会话历史，不触发规划与合成。 */
export const TranscriptionPreviewSchema = TurnIdentitySchema.extend({
  text: z.string().trim().min(1).max(1000),
  simulated: z.boolean(),
}).strict();

/** 只取消路由指定的轮次，并提交最终快照；旧取消不能影响新轮。 */
export const CancelTurnSchema = z
  .object({
    generation: z.number().int().positive(),
    receipts: z.array(ReceiptSchema).max(32).default([]),
    // 明确这是取消前的最终快照，后续成功回调不能追加。
    frozen: z.literal(true),
  })
  .strict();

// 传输：HTTP 错误与单轮 SSE

/** HTTP 与流内错误共用的稳定分类，供恢复逻辑使用。 */
export const ErrorCodeSchema = z.enum([
  'INVALID_REQUEST',
  'NO_SPEECH',
  'UNAUTHORIZED',
  'SESSION_EXPIRED',
  'TURN_CONFLICT',
  'STALE_TURN',
  'INPUT_CONFLICT',
  'INPUT_IN_PROGRESS',
  'INPUT_COMPLETED',
  'TURN_CANCELLED',
  'RATE_LIMITED',
  'CAPACITY_EXCEEDED',
  'PROVIDER_FAILED',
  'PROVIDER_TIMEOUT',
  'INVALID_PLAN',
  'FIRST_AUDIO_TIMEOUT',
  'NEXT_SEGMENT_TIMEOUT',
  'TURN_TIMEOUT',
  'MEDIA_NOT_FOUND',
  'MEDIA_FAILED',
  'UPLOAD_TOO_LARGE',
  'UNSUPPORTED_AUDIO',
  'STREAM_INTERRUPTED',
  'INTERNAL_ERROR',
]);

/** 面向用户的安全错误；retryable 表示可重试，不授权自动重放已处理输入。 */
export const PublicErrorSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string().max(240),
  retryable: z.boolean(),
});

export type PublicError = z.infer<typeof PublicErrorSchema>;

/** 流开始前的统一错误响应；requestId 用于排错，不向浏览器返回原始堆栈或凭证。 */
export const HttpErrorSchema = z.object({ error: PublicErrorSchema, requestId: z.string() });

/** 传输身份：eventId 去重、seq 校验流内顺序；它们不替代片段/视觉事件的回执目标。 */
const Envelope = TurnIdentitySchema.extend({
  schemaVersion: z.literal(SCHEMA_VERSION),
  eventId: IdSchema,
  // 每条连接从 1 连续递增；重复/缺口由客户端检查。
  seq: z.number().int().positive(),
});

/** type 决定 payload；ready 先于业务事件，心跳使用 SSE comment，不进入业务联合。 */
export const ServerEventSchema = z.discriminatedUnion('type', [
  Envelope.extend({
    type: z.literal('ready'),
    payload: z.object({
      streamId: IdSchema,
      // 剩余整轮预算，覆盖生成、背压与呈现；不是音频长度。
      remainingLifetimeMs: z.number().int().positive().max(3600000),
    }),
  }),
  Envelope.extend({
    // 录音转录结果；simulated 明示 Mock 的示例识别。
    type: z.literal('input.transcribed'),
    payload: z.object({ text: z.string().max(1000), simulated: z.boolean() }),
  }),
  Envelope.extend({ type: z.literal('image.pending'), payload: ImagePendingPayloadSchema }),
  Envelope.extend({ type: z.literal('image.ready'), payload: ImageReadyPayloadSchema }),
  // 音频可下载后才能入队，实际播放开始仍由调度器决定。
  Envelope.extend({ type: z.literal('audio.ready'), payload: AudioReadyPayloadSchema }),
  Envelope.extend({ type: z.literal('text.ready'), payload: CaptionReadyPayloadSchema }),
  Envelope.extend({
    type: z.literal('presentation.ready'),
    payload: PresentationReadyPayloadSchema,
  }),
  Envelope.extend({
    // 仅表示生成结束；正常 EOF 后，有效音频仍可继续播放并提交回执。
    type: z.literal('reply.done'),
    payload: z.object({
      segmentCount: z.number().int().min(0).max(4),
      // 与台词同次规划；客户端等全部呈现完成再展示。兼容旧服务端未发送此字段。
      suggestions: ReplySuggestionsSchema.optional(),
    }),
  }),
  // 流开始后用此事件结束失败，不再发送第二个 HTTP JSON 响应。
  Envelope.extend({ type: z.literal('error'), payload: PublicErrorSchema }),
]);

export type ServerEvent = z.infer<typeof ServerEventSchema>;

// HTTP 边界：路径参数与健康检查

/** 会话路由的 :id；格式合法不代表已通过会话鉴权。 */
export const RouteParamsSchema = z.object({ id: IdSchema });

/** 轮次路由复用会话参数，generation 由请求正文补齐。 */
export const TurnParamsSchema = RouteParamsSchema.extend({ turnId: IdSchema });

/** 私有媒体仅按资产 ID 读取；服务端仍须校验会话与资产归属。 */
export const MediaParamsSchema = z.object({ assetId: IdSchema });

/** 存活检查，只确认进程可响应。 */
export const HealthSchema = z.object({ status: z.literal('ok') });

/** 配置就绪与运行模式，不调用付费服务，也不证明远端账户可用。 */
export const ReadySchema = z.object({ status: z.literal('ready'), mode: z.enum(['mock', 'live']) });

// Stateless connection monitoring: no conversation, credentials, or presentation events.
export const CONNECTION_HEARTBEAT_MS = 5_000 as const;
export const CONNECTION_IDLE_MS = 15_000 as const;
export const ConnectionEventSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    type: z.enum(['connection.ready', 'connection.heartbeat']),
    connectionId: IdSchema,
    seq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    status: z.literal('ready'),
    heartbeatIntervalMs: z.literal(CONNECTION_HEARTBEAT_MS),
  })
  .strict();
export type ConnectionEvent = z.infer<typeof ConnectionEventSchema>;
export const ConnectionProbeSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    status: z.literal('ok'),
  })
  .strict();
export type ConnectionProbe = z.infer<typeof ConnectionProbeSchema>;
