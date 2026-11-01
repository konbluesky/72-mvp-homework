import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { toneWav } from '../../../../tests/fixtures/audio.js';
import { loadConfig } from '../config/index.js';
import { normalizeRecording } from './audio-input.js';

const exec = promisify(execFile);
const config = loadConfig({});
const source = toneWav();
const signal = () => new AbortController().signal;
async function encode(format: string, codec: string, extra: string[] = [], bytes = source) {
  const pending = exec(
    config.FFMPEG_PATH,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      'pipe:0',
      '-c:a',
      codec,
      ...extra,
      '-f',
      format,
      'pipe:1',
    ],
    { encoding: 'buffer', timeout: 5000, maxBuffer: 4 * 1024 * 1024 },
  );
  pending.child.stdin?.end(bytes);
  return (await pending).stdout;
}

describe('actual recording decode boundary (requires ffmpeg, never a provider key)', () => {
  it.each([
    ['webm', 'libopus', 'audio/webm', []],
    ['ogg', 'libopus', 'audio/ogg', []],
    ['mp4', 'aac', 'audio/mp4', ['-movflags', 'frag_keyframe+empty_moov']],
    ['mp3', 'libmp3lame', 'audio/mpeg', []],
  ] as const)(
    'decodes %s and measures samples rather than trusting duration metadata',
    async (format, codec, mimeType, extra) => {
      const bytes = await encode(format, codec, [...extra]);
      const normalized = await normalizeRecording({ bytes, mimeType }, config, signal());
      expect(normalized.mimeType).toBe('audio/wav');
      expect(normalized.durationMs).toBeGreaterThan(4700);
      expect(normalized.durationMs).toBeLessThan(5100);
      const buffer = Buffer.from(normalized.bytes);
      expect(buffer.readUInt32LE(24)).toBe(16000);
      expect(buffer.readUInt16LE(22)).toBe(1);
      expect(buffer.length - 44).toBe(Math.round(normalized.durationMs * 32));
    },
  );
  it('accepts actual short WAV but rejects false MIME and truncated/malformed data', async () => {
    const bytes = source;
    expect(
      (await normalizeRecording({ bytes, mimeType: 'audio/wav' }, config, signal())).durationMs,
    ).toBeGreaterThan(4000);
    await expect(
      normalizeRecording({ bytes, mimeType: 'audio/webm' }, config, signal()),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_AUDIO' });
    const garbage = Buffer.alloc(100);
    garbage.write('RIFF', 0);
    garbage.write('WAVE', 8);
    await expect(
      normalizeRecording({ bytes: garbage, mimeType: 'audio/wav' }, config, signal()),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
  it('rejects a 16-second recording regardless of client duration claims', async () => {
    const bytes = await encode('webm', 'libopus', [], toneWav(16000));
    await expect(
      normalizeRecording({ bytes, mimeType: 'audio/webm' }, config, signal()),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
  it('caps decoder concurrency and kills a running decode on cancellation', async () => {
    const bytes = source;
    const controller = new AbortController();
    const a = normalizeRecording({ bytes, mimeType: 'audio/wav' }, config, controller.signal);
    const b = normalizeRecording({ bytes, mimeType: 'audio/wav' }, config, signal());
    const c = normalizeRecording({ bytes, mimeType: 'audio/wav' }, config, signal());
    await expect(c).rejects.toMatchObject({ code: 'CAPACITY_EXCEEDED' });
    controller.abort();
    await expect(a).rejects.toThrow();
    await expect(b).resolves.toMatchObject({ mimeType: 'audio/wav' });
  });
  it('cancellation rejects before decoding and missing executables fail safely', async () => {
    const bytes = source;
    const controller = new AbortController();
    controller.abort();
    await expect(
      normalizeRecording({ bytes, mimeType: 'audio/wav' }, config, controller.signal),
    ).rejects.toThrow();
    await expect(
      normalizeRecording(
        { bytes, mimeType: 'audio/wav' },
        { ...config, FFMPEG_PATH: '/missing-mira-ffmpeg' },
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_AUDIO' });
  });
});
