import { loadConfig } from '../src/config/index.js';
import { MediaService, type MediaStore } from '../src/media/index.js';
import type {
  ProviderSet,
  SpeechToTextProvider,
  ReplyPlanner,
  TextToSpeechProvider,
} from '../src/providers/index.js';

export function testConfig(extra: Record<string, string> = {}) {
  return loadConfig({ NODE_ENV: 'test', MAX_SESSIONS_PER_MINUTE: '100', ...extra });
}
export function wav(): Uint8Array {
  const data = Buffer.alloc(16044);
  data.write('RIFF', 0);
  data.writeUInt32LE(16036, 4);
  data.write('WAVE', 8);
  data.write('fmt ', 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16000, 24);
  data.writeUInt32LE(32000, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(16000, 40);
  return data;
}
export class MemoryMediaStore implements MediaStore {
  readonly entries = new Map<string, Uint8Array>();
  async put(id: string, bytes: Uint8Array, _mimeType: string, signal: AbortSignal) {
    signal.throwIfAborted();
    this.entries.set(id, bytes);
  }
  async get(id: string) {
    const bytes = this.entries.get(id);
    if (!bytes) throw new Error('missing');
    return bytes;
  }
  async delete(id: string) {
    this.entries.delete(id);
  }
  async close() {
    this.entries.clear();
  }
}
export function testMedia(config = testConfig()) {
  return new MediaService(config, new MemoryMediaStore());
}
export const oneSegment = {
  suggestions: [],
  segments: [{ text: '雨还在下，我们慢慢聊。', emotion: 'curious', action: 'none', events: [] }],
};
export function testProviders(
  overrides: {
    plan?: ReplyPlanner['plan'];
    transcribe?: SpeechToTextProvider['transcribe'];
    synthesize?: TextToSpeechProvider['synthesize'];
  } = {},
): ProviderSet & { stt: SpeechToTextProvider } {
  return {
    planner: {
      info: { provider: 'test', model: 'plan' },
      plan: overrides.plan ?? (async () => oneSegment),
    },
    stt: {
      info: { provider: 'test', model: 'stt' },
      transcribe:
        overrides.transcribe ?? (async () => ({ text: '这场雨什么时候停？', simulated: true })),
    },
    tts: {
      info: { provider: 'test', model: 'tts' },
      synthesize: overrides.synthesize ?? (async () => ({ bytes: wav(), mimeType: 'audio/wav' })),
    },
  };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
