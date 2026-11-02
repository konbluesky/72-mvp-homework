import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { isIP } from 'node:net';
import { z } from 'zod';

const positive = (fallback: number, max = 3_600_000) =>
  z.coerce.number().int().positive().max(max).default(fallback);
const jsonObject = z
  .string()
  .default('{}')
  .transform((value, ctx): Record<string, unknown> => {
    try {
      const result: unknown = JSON.parse(value);
      const parsed = z.record(z.string(), z.unknown()).safeParse(result);
      if (parsed.success) return parsed.data;
    } catch {
      /* Report only the field name, never configuration contents. */
    }
    ctx.addIssue({ code: 'custom', message: 'Must be a JSON object' });
    return z.NEVER;
  });
const base = z.object({
  APP_MODE: z.enum(['mock', 'live']).default('mock'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: positive(3000, 65535),
  PUBLIC_API_BASE_URL: z.url().default('http://localhost:3000'),
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((s) =>
      s
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  TRUST_PROXY: z
    .string()
    .default('false')
    .transform((value, ctx): false | string[] => {
      if (value === 'false') return false;
      const addresses = value.split(',').map((entry) => entry.trim());
      const valid = addresses.every((entry) => {
        const parts = entry.split('/');
        const address = parts[0];
        if (!address || parts.length > 2) return false;
        const version = isIP(address);
        if (!version) return false;
        return (
          parts.length === 1 ||
          (/^\d+$/.test(parts[1] ?? '') &&
            Number(parts[1]) > 0 &&
            Number(parts[1]) <= (version === 4 ? 32 : 128))
        );
      });
      if (!valid) {
        ctx.addIssue({
          code: 'custom',
          message: 'Use false or explicit proxy IP/CIDR addresses; true/wildcard is forbidden',
        });
        return z.NEVER;
      }
      return addresses;
    }),
  GPT_PROVIDER: z.literal('openai-compatible').default('openai-compatible'),
  GPT_BASE_URL: z.string().default(''),
  GPT_API_KEY: z.string().default(''),
  GPT_MODEL: z.string().default(''),
  GPT_API_STYLE: z.enum(['chat_completions', 'responses']).default('chat_completions'),
  GPT_STRUCTURED_OUTPUT: z
    .enum(['json_schema', 'json_mode', 'function_calling'])
    .default('json_schema'),
  GPT_TIMEOUT_MS: positive(12000),
  GPT_MAX_OUTPUT_TOKENS: positive(600, 4096),
  GPT_MAX_RETRIES: z.coerce.number().int().min(0).max(1).default(0),
  GPT_HEADERS_JSON: jsonObject,
  GPT_EXTRA_BODY_JSON: jsonObject,
  LANGGRAPH_RECURSION_LIMIT: positive(12, 20),
  MAX_SCHEMA_REPAIRS: z.coerce.number().int().min(0).max(1).default(1),
  LANGSMITH_TRACING: z.literal('false').default('false'),
  STT_PROVIDER: z.enum(['deepgram', 'disabled']).default('deepgram'),
  DEEPGRAM_STT_MODEL: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .default('nova-3'),
  DEEPGRAM_STT_LANGUAGE: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[a-zA-Z]+(?:-[a-zA-Z0-9]+)*$/)
    .default('zh-CN'),
  STT_TIMEOUT_MS: positive(8000),
  TTS_PROVIDER: z.literal('deepgram').default('deepgram'),
  DEEPGRAM_BASE_URL: z.literal('https://api.deepgram.com').default('https://api.deepgram.com'),
  DEEPGRAM_API_VERSION: z.literal('v2').default('v2'),
  DEEPGRAM_API_KEY: z.string().default(''),
  DEEPGRAM_MODEL: z.string().default(''),
  DEEPGRAM_ENCODING: z.literal('mp3').default('mp3'),
  TTS_TIMEOUT_MS: positive(10000),
  SESSION_STORE: z.literal('memory').default('memory'),
  CONTEXT_HISTORY_TOKENS: positive(1800, 16000),
  // 0 retains sessions until an explicit restart or process shutdown.
  SESSION_TTL_SECONDS: z.coerce.number().int().min(0).max(31_536_000).default(0),
  MAX_SESSIONS: positive(100, 10000),
  MAX_ACTIVE_TURNS: positive(8, 100),
  MAX_TURNS_PER_SESSION: positive(24, 100),
  RATE_LIMIT_ENABLED: z.enum(['true', 'false']).transform((value) => value === 'true'),
  MAX_INPUTS_PER_MINUTE: positive(12, 1000),
  MAX_SESSIONS_PER_MINUTE: positive(10, 1000),
  HEARTBEAT_INTERVAL_MS: positive(10000, 60000),
  IMAGE_PROVIDER: z.enum(['disabled', 'comfyui']).default('disabled'),
  COMFYUI_BASE_URL: z.url().default('https://kindra-tune.hottv.ai/'),
  COMFYUI_HEADERS_JSON: jsonObject,
  COMFYUI_OUTPUT: z.enum(['view', 's3']).default('view'),
  COMFYUI_CHECKPOINT: z.string().min(1).max(200).default('oneObsession_v24.safetensors'),
  COMFYUI_S3_ORIGIN: z.string().default(''),
  IMAGE_JOB_TIMEOUT_MS: positive(900000, 1800000),
  IMAGE_REQUEST_TIMEOUT_MS: positive(15000, 60000),
  IMAGE_POLL_MS: positive(3000, 30000),
  IMAGE_LONG_WAIT_MS: positive(30000, 300000),
  IMAGE_ASSET_TTL_SECONDS: positive(1800, 86400),
  IMAGE_MAX_ACTIVE: positive(1, 8),
  IMAGE_MAX_QUEUED: positive(8, 32),
  MAX_IMAGE_BYTES: positive(12582912, 33554432),
  MOCK_IMAGE_DELAY_MS: positive(6000, 120000),
  MOCK_IMAGE_FAILURE: z.enum(['none', 'first', 'always']).default('none'),
  MEDIA_STORE: z.enum(['local', 'r2']).default('local'),
  MEDIA_LOCAL_DIR: z.string().default('./data/media'),
  MEDIA_DELIVERY: z.literal('api_proxy').default('api_proxy'),
  MEDIA_TTL_SECONDS: positive(600, 86400),
  MAX_MEDIA_BYTES: positive(67108864, 1073741824),
  MAX_AUDIO_BYTES: positive(4194304, 16777216),
  R2_ENDPOINT: z.string().default(''),
  R2_REGION: z.literal('auto').default('auto'),
  R2_ACCESS_KEY_ID: z.string().default(''),
  R2_SECRET_ACCESS_KEY: z.string().default(''),
  R2_BUCKET: z.string().default(''),
  FIRST_AUDIO_TIMEOUT_MS: positive(20000),
  NEXT_SEGMENT_TIMEOUT_MS: positive(20000),
  TURN_MAX_LIFETIME_MS: positive(120000),
  MAX_RECORDING_SECONDS: positive(15, 30),
  FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
  MAX_UPLOAD_BYTES: positive(4194304, 16777216),
});

export const ProbeStageSchema = z.enum(['capabilities', 'stt', 'plan', 'tts']);
type ProviderRole = Exclude<z.infer<typeof ProbeStageSchema>, 'capabilities'>;
function configurationSchema(required: ReadonlySet<ProviderRole>, application: boolean) {
  return base.superRefine((config, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    const isOrigin = (value: string) => {
      try {
        const u = new URL(value);
        return ['http:', 'https:'].includes(u.protocol) && u.origin === value;
      } catch {
        return false;
      }
    };
    if (
      config.CORS_ALLOWED_ORIGINS.length === 0 ||
      config.CORS_ALLOWED_ORIGINS.some((v) => !isOrigin(v))
    )
      issue('CORS_ALLOWED_ORIGINS', 'Use explicit HTTP(S) origins without paths or wildcards');
    try {
      const url = new URL(config.COMFYUI_BASE_URL);
      if (
        !['https:', 'http:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        issue('COMFYUI_BASE_URL', 'Use an HTTP(S) API root without credentials');
    } catch {
      issue('COMFYUI_BASE_URL', 'Invalid API root');
    }
    for (const [key, value] of Object.entries(config.COMFYUI_HEADERS_JSON))
      if (
        !/^[a-z0-9-]+$/i.test(key) ||
        ['host', 'content-length', 'connection'].includes(key.toLowerCase()) ||
        typeof value !== 'string' ||
        /[\r\n]/.test(value)
      )
        issue('COMFYUI_HEADERS_JSON', 'Use string authentication headers');
    if (config.COMFYUI_OUTPUT === 's3') {
      try {
        const u = new URL(config.COMFYUI_S3_ORIGIN);
        if (u.protocol !== 'https:' || u.origin !== config.COMFYUI_S3_ORIGIN)
          issue('COMFYUI_S3_ORIGIN', 'Use an explicit HTTPS object origin');
      } catch {
        issue('COMFYUI_S3_ORIGIN', 'Required for S3 output');
      }
    }
    if (config.APP_MODE === 'live') {
      const requireValue = (
        name: 'GPT_BASE_URL' | 'GPT_API_KEY' | 'GPT_MODEL' | 'DEEPGRAM_API_KEY' | 'DEEPGRAM_MODEL',
      ) => {
        if (!config[name].trim()) issue(name, 'Required for the selected live capability');
      };
      if (required.has('plan')) {
        for (const name of ['GPT_BASE_URL', 'GPT_API_KEY', 'GPT_MODEL'] as const)
          requireValue(name);
        try {
          const u = new URL(config.GPT_BASE_URL);
          if (
            !['https:', 'http:'].includes(u.protocol) ||
            u.username ||
            u.password ||
            u.search ||
            u.hash
          )
            issue('GPT_BASE_URL', 'Use a provider API root URL');
        } catch {
          issue('GPT_BASE_URL', 'Invalid provider URL');
        }
      }
      if (required.has('tts') || (required.has('stt') && config.STT_PROVIDER !== 'disabled'))
        requireValue('DEEPGRAM_API_KEY');
      if (required.has('tts')) {
        requireValue('DEEPGRAM_MODEL');
        if (config.DEEPGRAM_MODEL && !/^flux-[a-z]+-zh$/.test(config.DEEPGRAM_MODEL))
          issue('DEEPGRAM_MODEL', 'This Chinese MVP supports a Flux Chinese voice on v2 only');
      }
    }
    if (application && config.MEDIA_STORE === 'r2') {
      for (const name of [
        'R2_ENDPOINT',
        'R2_ACCESS_KEY_ID',
        'R2_SECRET_ACCESS_KEY',
        'R2_BUCKET',
      ] as const)
        if (!config[name]) issue(name, 'Required for R2 in every mode');
      if (!/^https:\/\/[a-zA-Z0-9.-]+\.r2\.cloudflarestorage\.com\/?$/.test(config.R2_ENDPOINT))
        issue('R2_ENDPOINT', 'Use the HTTPS R2 S3 account endpoint');
    }
    for (const [key, value] of Object.entries(config.GPT_HEADERS_JSON)) {
      if (!/^x-[a-z0-9-]+$/i.test(key) || typeof value !== 'string' || /[\r\n]/.test(value))
        issue('GPT_HEADERS_JSON', 'Only string X-* headers are accepted');
    }
    const extra = z
      .object({
        temperature: z.number().min(0).max(2).optional(),
        top_p: z.number().min(0).max(1).optional(),
      })
      .strict()
      .safeParse(config.GPT_EXTRA_BODY_JSON);
    if (!extra.success)
      issue(
        'GPT_EXTRA_BODY_JSON',
        'Only numeric temperature/top_p are supported; contract and credentials cannot be overridden',
      );
    if (
      required.has('plan') &&
      config.GPT_API_STYLE === 'responses' &&
      config.GPT_STRUCTURED_OUTPUT === 'json_mode'
    )
      issue(
        'GPT_STRUCTURED_OUTPUT',
        'responses/json_mode is not enabled; use json_schema or function_calling',
      );
    if (config.TURN_MAX_LIFETIME_MS <= config.FIRST_AUDIO_TIMEOUT_MS)
      issue('TURN_MAX_LIFETIME_MS', 'Must exceed first-audio budget');
  });
}
export const ConfigSchema = configurationSchema(new Set(['stt', 'plan', 'tts']), true);
export type Config = z.infer<typeof ConfigSchema>;
export const serverRoot = fileURLToPath(new URL('../../', import.meta.url));
function parseConfiguration(
  env: Record<string, string | undefined>,
  schema: ReturnType<typeof configurationSchema>,
): Config {
  const parsed = schema.safeParse({
    ...env,
    RATE_LIMIT_ENABLED:
      env.RATE_LIMIT_ENABLED ??
      ((env.NODE_ENV ?? 'development') === 'development' ? 'false' : 'true'),
  });
  if (!parsed.success) {
    // Do not include Zod input values: these fields may contain API keys.
    throw new Error(
      `Invalid server configuration: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  return { ...parsed.data, MEDIA_LOCAL_DIR: resolve(serverRoot, parsed.data.MEDIA_LOCAL_DIR) };
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return parseConfiguration(env, ConfigSchema);
}
/** Standalone diagnostics require only their stage's credentials, never unrelated services. */
export function loadProbeConfig(
  env: Record<string, string | undefined>,
  stage: z.infer<typeof ProbeStageSchema>,
): Config {
  return parseConfiguration(
    env,
    configurationSchema(new Set(stage === 'capabilities' ? [] : [stage]), false),
  );
}
