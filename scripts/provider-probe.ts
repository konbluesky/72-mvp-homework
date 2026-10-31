import { parseArgs } from 'node:util';
import { open, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { ReplyPlanSchema } from '@mira/protocol';
import { loadProbeConfig, ProbeStageSchema, serverRoot } from '../apps/server/src/config/index.js';
import { createProviders, ProviderError } from '../apps/server/src/providers/index.js';
import { normalizeRecording } from '../apps/server/src/providers/audio-input.js';
import { validateStory } from '../apps/server/src/scenario/rules.js';

// Offline by default. A named stage is an explicit, bounded external-service probe in Live.
let stage = 'capabilities';
try {
  const { values } = parseArgs({
    options: {
      stage: { type: 'string', default: 'capabilities' },
      audio: { type: 'string' },
      text: { type: 'string', default: '你好，请坐。' },
      output: { type: 'string' },
    },
  });
  const selected = ProbeStageSchema.parse(values.stage);
  stage = selected;
  if (!values.text.trim() || values.text.length > 160)
    throw new Error('Probe text must contain 1–160 characters');
  loadEnv({ path: resolve(serverRoot, '.env'), quiet: true });
  const config = loadProbeConfig(
    { ...process.env, GPT_MAX_RETRIES: '0', GPT_MAX_OUTPUT_TOKENS: '300' },
    selected,
  );
  const providers = createProviders(config);
  const signal = AbortSignal.timeout(45_000);
  const started = performance.now();
  const summary: Record<string, unknown> = { stage, mode: config.APP_MODE };
  if (stage === 'capabilities') {
    Object.assign(summary, {
      stt: providers.stt?.info ?? null,
      planner: providers.planner.info,
      tts: providers.tts.info,
    });
  } else if (stage === 'stt') {
    if (!providers.stt) throw new Error('Speech input is disabled');
    if (!values.audio) throw new Error('Use --audio with a short local WAV recording');
    const path = resolve(values.audio);
    const file = await open(path, 'r');
    let bytes: Buffer;
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > config.MAX_UPLOAD_BYTES)
        throw new Error('Audio exceeds the upload limit');
      bytes = await file.readFile();
    } finally {
      await file.close();
    }
    // Canonical probe input is WAV; browser input may use any supported MediaRecorder container.
    const audio = await normalizeRecording({ bytes, mimeType: 'audio/wav' }, config, signal);
    const result = await providers.stt.transcribe(audio, signal);
    Object.assign(summary, {
      ...providers.stt.info,
      characters: result.text.length,
      simulated: result.simulated,
      requestId: result.requestId ?? 'unknown',
      audioDurationSeconds: result.durationSeconds ?? audio.durationMs / 1000,
    });
  } else if (stage === 'plan') {
    const state = Annotation.Root({ raw: Annotation<unknown>() });
    const graph = new StateGraph(state)
      .addNode('probe', async () => ({
        raw: await providers.planner.plan({ text: values.text, facts: [], history: [] }, signal),
      }))
      .addEdge(START, 'probe')
      .addEdge('probe', END)
      .compile();
    const result = await graph.invoke({ raw: null }, { signal, recursionLimit: 3 });
    const plan = ReplyPlanSchema.parse(result.raw);
    validateStory(plan, values.text, { photo_revealed: false, rain_softened: false });
    Object.assign(summary, {
      ...providers.planner.info,
      segments: plan.segments.length,
      characters: plan.segments.reduce((total, line) => total + line.text.length, 0),
    });
  } else {
    const audio = await providers.tts.synthesize(values.text, signal);
    Object.assign(summary, {
      ...providers.tts.info,
      bytes: audio.bytes.length,
      mimeType: audio.mimeType,
      requestId: audio.requestId ?? 'unknown',
    });
    if (values.output) {
      const path = resolve(values.output);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, audio.bytes, { flag: 'wx' });
      summary.output = path;
    }
  }
  process.stdout.write(
    JSON.stringify({ ...summary, durationMs: Math.round(performance.now() - started) }) + '\n',
  );
} catch (error) {
  const failure =
    error instanceof ProviderError
      ? { code: error.code, ...error.details, retryable: error.retryable }
      : error instanceof Error && error.message.startsWith('Invalid server configuration:')
        ? { code: 'INVALID_CONFIGURATION', message: error.message }
        : { code: 'PROBE_FAILED' };
  // Never print raw model/transcript/provider bodies, configuration values, headers or stacks.
  process.stderr.write(JSON.stringify({ stage, ok: false, ...failure }) + '\n');
  process.exitCode = 1;
}
