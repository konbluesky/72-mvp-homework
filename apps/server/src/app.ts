import { defaultScenario } from './scenario/index.js';
import type { ScenarioDefinition } from './scenario/ports.js';
import Fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  BeginTurnSchema,
  BeginTurnResponseSchema,
  CancelTurnSchema,
  ReceiptsRequestSchema,
  ReceiptsResponseSchema,
  SessionCreatedSchema,
  CreateSessionSchema,
  SessionSnapshotSchema,
  RouteParamsSchema,
  TurnParamsSchema,
  MediaParamsSchema,
  JsonInputSchema,
  AudioInputMetadataSchema,
  HealthSchema,
  ConnectionProbeSchema,
  SCHEMA_VERSION,
  ConnectionEventSchema,
  ReadySchema,
  HttpErrorSchema,
  ServerEventSchema,
  TranscriptionPreviewSchema,
} from '@mira/protocol';
import { loadConfig, type Config } from './config/index.js';
import { createProviders, type ProviderSet } from './providers/index.js';
import { createMediaService, cleanupLocalOrphans, type MediaService } from './media/index.js';
import { SessionManager, type Session, type Turn } from './sessions/manager.js';
import { AppError, publicError } from './http/errors.js';
import { readInput } from './http/input.js';
import { openStream } from './http/sse.js';
import { ConnectionStreams } from './http/connection.js';
import { runConversation } from './graphs/conversation.js';
import { abortable } from './graphs/abortable.js';
import { transcribeRecording } from './graphs/transcription.js';

export interface AppOptions {
  scenario?: ScenarioDefinition;
  config?: Config;
  providers?: ProviderSet;
  media?: MediaService;
  sessions?: SessionManager;
  logger?: boolean;
}
const errors = {
  400: HttpErrorSchema,
  401: HttpErrorSchema,
  403: HttpErrorSchema,
  404: HttpErrorSchema,
  409: HttpErrorSchema,
  410: HttpErrorSchema,
  413: HttpErrorSchema,
  415: HttpErrorSchema,
  422: HttpErrorSchema,
  429: HttpErrorSchema,
  500: HttpErrorSchema,
  502: HttpErrorSchema,
  503: HttpErrorSchema,
  504: HttpErrorSchema,
};

export async function createApp(options: AppOptions = {}) {
  const config = options.config ?? loadConfig();
  const media = options.media ?? createMediaService(config);
  const scenario = options.scenario ?? options.sessions?.scenario ?? defaultScenario;
  const providers = options.providers ?? createProviders(config, fetch, scenario.mockProviders);
  const sessions = options.sessions ?? new SessionManager(config, { scenario });
  if (sessions.scenario !== scenario) throw new Error('Session and Graph scenario must match.');
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: 'info',
            redact: ['req.headers.authorization', 'req.headers.cookie'],
            serializers: {
              req: (request) => ({
                method: request.method,
                url: request.url,
                remoteAddress: request.ip,
              }),
            },
          },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 16_384,
    requestTimeout: 30_000,
    connectionTimeout: 30_000,
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(cors, {
    origin: (origin, callback) =>
      callback(null, origin === undefined || config.CORS_ALLOWED_ORIGINS.includes(origin)),
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Session-Id'],
    credentials: false,
  });
  await app.register(multipart, {
    limits: { files: 1, fields: 1, parts: 2, fileSize: config.MAX_UPLOAD_BYTES, fieldSize: 2048 },
    throwFileSizeLimit: true,
  });
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: '角色互动平台 API', version: '1.0.0' },
      components: { securitySchemes: { sessionToken: { type: 'http', scheme: 'bearer' } } },
    },
    transform: jsonSchemaTransform,
    transformObject: (document) => {
      if (!('openapiObject' in document)) return document.swaggerObject;
      const { openapiObject } = document;
      const inputRoute = openapiObject.paths?.['/api/sessions/{id}/turns/{turnId}/input']?.post;
      if (inputRoute)
        Object.assign(inputRoute, {
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: z.toJSONSchema(JsonInputSchema) },
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['metadata', 'audio'],
                  properties: {
                    metadata: {
                      type: 'string',
                      description: 'JSON serialized AudioInputMetadata',
                      'x-json-schema': z.toJSONSchema(AudioInputMetadataSchema),
                    },
                    audio: { type: 'string', format: 'binary' },
                  },
                },
              },
            },
          },
        });
      const transcriptionRoute =
        openapiObject.paths?.['/api/sessions/{id}/turns/{turnId}/transcription']?.post;
      if (transcriptionRoute)
        Object.assign(transcriptionRoute, {
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['metadata', 'audio'],
                  properties: {
                    metadata: {
                      type: 'string',
                      description: 'JSON serialized AudioInputMetadata',
                      'x-json-schema': z.toJSONSchema(AudioInputMetadataSchema),
                    },
                    audio: { type: 'string', format: 'binary' },
                  },
                },
              },
            },
          },
        });
      if (inputRoute?.responses)
        Object.assign(inputRoute.responses, {
          '200': {
            description: 'POST SSE; reply.done ends generation, not presentation.',
            content: {
              'text/event-stream': {
                schema: { type: 'string' },
                'x-event-schema': z.toJSONSchema(ServerEventSchema),
              },
            },
          },
        });
      const connectionRoute = openapiObject.paths?.['/api/connection/events']?.get;
      if (connectionRoute?.responses)
        Object.assign(connectionRoute.responses, {
          '200': {
            description:
              'Long-lived, stateless server connection monitoring. Reconnect creates a new stream; no business replay.',
            content: {
              'text/event-stream': {
                schema: { type: 'string' },
                'x-event-schema': z.toJSONSchema(ConnectionEventSchema),
              },
            },
          },
        });
      const mediaRoute = openapiObject.paths?.['/api/media/{assetId}']?.get;
      if (mediaRoute?.responses)
        Object.assign(mediaRoute.responses, {
          '200': {
            description: 'Authenticated, private audio binary.',
            content: {
              'audio/wav': { schema: { type: 'string', format: 'binary' } },
              'audio/mpeg': { schema: { type: 'string', format: 'binary' } },
            },
          },
        });
      return openapiObject;
    },
  });
  app.addHook('onRequest', async (_request, reply) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header('Cache-Control', 'no-store');
  });
  app.setErrorHandler((error, request, reply) => {
    if (reply.raw.destroyed) return;
    if (reply.raw.headersSent) {
      if (!reply.raw.writableEnded) reply.raw.end();
      return;
    }
    let safe = publicError(error);
    if (error instanceof Error && 'validation' in error)
      safe = new AppError('INVALID_REQUEST', 400, '请求格式不正确，请重新输入。');
    if (
      error instanceof Error &&
      'code' in error &&
      [
        'FST_REQ_FILE_TOO_LARGE',
        'FST_FILES_LIMIT',
        'FST_FIELDS_LIMIT',
        'FST_PARTS_LIMIT',
        'FST_ERR_CTP_BODY_TOO_LARGE',
      ].includes(String(error.code))
    )
      safe = new AppError('UPLOAD_TOO_LARGE', 413, '输入太大，请缩短后重试。');
    if (error instanceof Error && 'statusCode' in error && Number(error.statusCode) === 400)
      safe = new AppError('INVALID_REQUEST', 400, '请求格式不正确，请重新输入。');
    if (error instanceof Error && 'statusCode' in error && Number(error.statusCode) === 415)
      safe = new AppError('INVALID_REQUEST', 415, '提交格式不支持，请使用文字或录音。');
    request.log.info({ requestId: request.id, code: safe.code, stage: 'http' });
    void reply.status(safe.status).send({
      error: { code: safe.code, message: safe.message, retryable: safe.retryable },
      requestId: request.id,
    });
  });
  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      error: { code: 'INVALID_REQUEST', message: '这个入口不存在。', retryable: false },
      requestId: request.id,
    }),
  );
  const creationTimes = new Map<string, number[]>();
  const receivingInput = new Map<string, Turn>();

  async function receiveInput(request: FastifyRequest, session: Session, turnId: string) {
    const uploadTurn = session.turns.get(turnId);
    if (!uploadTurn) throw new AppError('STALE_TURN', 409, '旧的回应已结束。');
    sessions.assertCurrent(session, uploadTurn);
    if (receivingInput.has(session.id) || receivingInput.size >= config.MAX_ACTIVE_TURNS)
      throw new AppError('CAPACITY_EXCEEDED', 429, '录音正在传送，请稍后再试。', true);
    receivingInput.set(session.id, uploadTurn);
    uploadTurn.uploadRequestId = request.id;
    const releaseUpload = () => {
      // An older reader's finally must never release a newer turn's upload slot.
      if (receivingInput.get(session.id) === uploadTurn) receivingInput.delete(session.id);
      if (uploadTurn.uploadRequestId === request.id) uploadTurn.uploadRequestId = undefined;
    };
    const abortUpload = () => {
      releaseUpload();
      request.raw.destroy();
    };
    uploadTurn.abort.signal.addEventListener('abort', abortUpload, { once: true });
    let input;
    try {
      input = await abortable(readInput(request, config), uploadTurn.abort.signal);
      sessions.assertCurrent(session, uploadTurn);
    } finally {
      uploadTurn.abort.signal.removeEventListener('abort', abortUpload);
      releaseUpload();
    }
    return input;
  }
  const connectionStreams = new ConnectionStreams();
  // preClose runs before Fastify waits for active long-lived responses.
  app.addHook('preClose', async () => {
    connectionStreams.close();
  });
  app.get(
    '/api/connection/ping',
    {
      logLevel: 'warn',
      schema: { response: { 200: ConnectionProbeSchema } },
    },
    async () => ({ schemaVersion: SCHEMA_VERSION, status: 'ok' as const }),
  );
  app.get(
    '/api/connection/events',
    {
      logLevel: 'warn',
      schema: {
        response: {
          200: z.string().describe('Stateless SSE connection.ready/connection.heartbeat frames'),
          ...errors,
        },
      },
    },
    async (request, reply) => {
      const origin = request.headers.origin;
      if (origin !== undefined && !config.CORS_ALLOWED_ORIGINS.includes(origin))
        throw new AppError('INVALID_REQUEST', 403, '连接来源不受支持。');
      if (!connectionStreams.open(reply))
        throw new AppError('CAPACITY_EXCEEDED', 503, '连接监测暂忙，正在重试。', true);
    },
  );
  app.get('/healthz', { schema: { response: { 200: HealthSchema } } }, async () => ({
    status: 'ok' as const,
  }));
  app.get('/readyz', { schema: { response: { 200: ReadySchema } } }, async () => ({
    status: 'ready' as const,
    mode: config.APP_MODE,
  }));
  app.post(
    '/api/sessions',
    {
      schema: {
        description:
          'Create an anonymous session; replaceSessionId requires its bearer token and atomically replaces that session.',
        security: [{}, { sessionToken: [] }],
        body: CreateSessionSchema.optional(),
        response: { 201: SessionCreatedSchema, ...errors },
      },
    },
    async (request, reply) => {
      const now = Date.now();
      const times = (creationTimes.get(request.ip) ?? []).filter((time) => time > now - 60_000);
      if (config.RATE_LIMIT_ENABLED && times.length >= config.MAX_SESSIONS_PER_MINUTE)
        throw new AppError('RATE_LIMITED', 429, '来访有些频繁，请稍后再试。', true);
      if (config.RATE_LIMIT_ENABLED && creationTimes.size >= 1000 && !creationTimes.has(request.ip))
        throw new AppError('CAPACITY_EXCEEDED', 503, '服务暂时繁忙，请稍后再试。', true);
      let previous: Session | undefined;
      if (request.body?.replaceSessionId) {
        try {
          previous = sessions.authenticate(
            request.body.replaceSessionId,
            request.headers.authorization,
          );
        } catch (error) {
          // The old session may already be gone after expiry or a process restart.
          if (!(error instanceof AppError && error.code === 'SESSION_EXPIRED')) throw error;
        }
      }
      const created = sessions.create(request.body?.entry ?? 'story', previous);
      if (config.RATE_LIMIT_ENABLED) creationTimes.set(request.ip, [...times, now]);
      return reply.status(201).send({
        ...created,
        capabilities: { voiceInput: Boolean(providers.stt) },
      });
    },
  );
  const security = [{ sessionToken: [] }];
  app.get(
    '/api/sessions/:id',
    {
      schema: {
        security,
        params: RouteParamsSchema,
        response: { 200: SessionSnapshotSchema, ...errors },
      },
    },
    async (request) => ({
      ...sessions.snapshot(sessions.authenticate(request.params.id, request.headers.authorization)),
      capabilities: { voiceInput: Boolean(providers.stt) },
    }),
  );
  app.post(
    '/api/sessions/:id/turns',
    {
      schema: {
        security,
        params: RouteParamsSchema,
        body: BeginTurnSchema,
        response: { 200: BeginTurnResponseSchema, ...errors },
      },
    },
    async (request) =>
      sessions.begin(
        sessions.authenticate(request.params.id, request.headers.authorization),
        request.body,
      ),
  );
  app.post(
    '/api/sessions/:id/turns/:turnId/cancel',
    {
      schema: {
        security,
        params: TurnParamsSchema,
        body: CancelTurnSchema,
        response: { 200: ReceiptsResponseSchema, ...errors },
      },
    },
    async (request) => ({
      acknowledged: sessions.cancelRequest(
        sessions.authenticate(request.params.id, request.headers.authorization),
        request.params.turnId,
        request.body.generation,
        request.body.receipts,
      ),
    }),
  );
  app.post(
    '/api/sessions/:id/receipts',
    {
      schema: {
        security,
        params: RouteParamsSchema,
        body: ReceiptsRequestSchema,
        response: { 200: ReceiptsResponseSchema, ...errors },
      },
    },
    async (request) => ({
      acknowledged: sessions.receipts(
        sessions.authenticate(request.params.id, request.headers.authorization),
        request.body.receipts,
      ),
    }),
  );
  app.get(
    '/api/media/:assetId',
    {
      schema: {
        security,
        params: MediaParamsSchema,
        headers: z.object({ 'x-session-id': z.string().min(1) }).passthrough(),
        response: { ...errors, 200: z.unknown().describe('Authenticated audio binary') },
      },
    },
    async (request, reply) => {
      const session = sessions.authenticate(
        request.headers['x-session-id'],
        request.headers.authorization,
      );
      const audio = await media.get(request.params.assetId, session.id);
      return reply
        .type(audio.mimeType)
        .header('Content-Length', audio.bytes.length)
        .send(Buffer.from(audio.bytes));
    },
  );
  app.post(
    '/api/sessions/:id/turns/:turnId/transcription',
    {
      schema: {
        security,
        params: TurnParamsSchema,
        description:
          'Transcription preview only. Does not create a user message or call planner/TTS. Confirm edited text in a new turn.',
        response: { 200: TranscriptionPreviewSchema, ...errors },
      },
    },
    async (request, reply) => {
      const session = sessions.authenticate(request.params.id, request.headers.authorization);
      if (!providers.stt)
        throw new AppError('UNSUPPORTED_AUDIO', 415, '当前模式暂不支持语音输入，请使用文字输入。');
      const input = await receiveInput(request, session, request.params.turnId);
      if (input.input.kind !== 'audio')
        throw new AppError('INVALID_REQUEST', 400, '请上传需要预览的录音。');
      const turn = sessions.startInput(
        session,
        request.params.turnId,
        input.generation,
        input.inputId,
        input.digest,
        { expectAudio: false },
      );
      const disconnected = () => {
        if (!reply.raw.writableFinished)
          sessions.fail(
            turn,
            new AppError('STREAM_INTERRUPTED', 499, '识别已取消，请重新录音。', true),
          );
      };
      reply.raw.once('close', disconnected);
      try {
        const transcription = await transcribeRecording(
          { config, providers, sessions, logger: request.log },
          session,
          turn,
          input.input,
        );
        sessions.assertCurrent(session, turn);
        sessions.generated(turn);
        return { ...turn.identity, text: transcription.text, simulated: transcription.simulated };
      } catch (error) {
        const failure = publicError(turn.failure ?? error);
        sessions.fail(turn, failure);
        throw failure;
      } finally {
        reply.raw.off('close', disconnected);
      }
    },
  );
  app.post(
    '/api/sessions/:id/turns/:turnId/input',
    {
      schema: {
        security,
        params: TurnParamsSchema,
        body: JsonInputSchema.nullish(),
        description:
          'POST SSE. The ready event precedes business events. reply.done means generation ended, never presentation. Multipart accepts metadata JSON and one audio file.',
        response: {
          ...errors,
          200: z
            .string()
            .describe('text/event-stream, validated ServerEvent frames and comment heartbeats'),
        },
      },
    },
    async (request, reply) => {
      const session = sessions.authenticate(request.params.id, request.headers.authorization);
      const input = await receiveInput(request, session, request.params.turnId);
      const turn = sessions.startInput(
        session,
        request.params.turnId,
        input.generation,
        input.inputId,
        input.digest,
        {
          expectAudio: input.input.kind !== 'interaction',
          contentDigest: input.contentDigest,
        },
      );
      turn.abort.signal.addEventListener(
        'abort',
        () => {
          void media.deleteTurn(session.id, turn.identity.turnId).catch(() =>
            request.log.warn({
              ...turn.identity,
              stage: 'cancel_media_cleanup',
              code: 'MEDIA_FAILED',
            }),
          );
        },
        { once: true },
      );
      const stream = await openStream(
        reply,
        sessions,
        session,
        turn,
        config.HEARTBEAT_INTERVAL_MS,
      ).catch((error: unknown) => {
        sessions.fail(turn, publicError(error));
        throw error;
      });
      request.log.info({
        ...turn.identity,
        requestId: request.id,
        streamId: turn.streamId,
        stage: 'input',
        inputKind: input.input.kind,
      });
      try {
        await runConversation(
          { config, providers, media, sessions, logger: request.log, scenario },
          session,
          turn,
          input.input,
          stream.publish,
        );
      } catch (error) {
        const safe = publicError(turn.failure ?? error);
        sessions.fail(turn, safe);
        await stream.error(safe);
        request.log.info({
          ...turn.identity,
          requestId: request.id,
          stage: 'turn',
          code: safe.code,
        });
      } finally {
        stream.finish();
      }
      return reply;
    },
  );
  const sweep = setInterval(() => {
    sessions.sweep();
    for (const [ip, times] of creationTimes)
      if ((times.at(-1) ?? 0) < Date.now() - 60_000) creationTimes.delete(ip);
    void media
      .cleanup()
      .catch(() => app.log.warn({ stage: 'media_cleanup', code: 'MEDIA_FAILED' }));
    void cleanupLocalOrphans(config).catch(() =>
      app.log.warn({ stage: 'orphan_cleanup', code: 'MEDIA_FAILED' }),
    );
  }, 30_000);
  sweep.unref();
  app.addHook('preClose', async () => {
    sessions.close();
  });
  app.addHook('onClose', async () => {
    clearInterval(sweep);
    sessions.close();
    await media.close();
  });
  await app.ready();
  return Object.assign(app, { services: { config, providers, media, sessions, scenario } });
}
