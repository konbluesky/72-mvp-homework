import { spawn } from 'node:child_process';
import type { Config } from '../config/index.js';
import type { AudioData } from './types.js';

export class AudioInputError extends Error {
  constructor(
    public readonly code: 'INVALID_REQUEST' | 'UNSUPPORTED_AUDIO' | 'CAPACITY_EXCEEDED',
    message: string,
  ) {
    super(message);
    this.name = 'AudioInputError';
  }
}
let decoding = 0;
const SAMPLE_RATE = 16000;
const DECODER_LIMIT = 2;
const DECODER_TIMEOUT_MS = 5000;

function matchesContainer(audio: AudioData): boolean {
  const b = audio.bytes;
  const text = (start: number, end: number) => new TextDecoder().decode(b.subarray(start, end));
  switch (audio.mimeType.split(';')[0]) {
    case 'audio/webm':
      return b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
    case 'audio/ogg':
      return text(0, 4) === 'OggS';
    case 'audio/mp4':
      return text(4, 8) === 'ftyp';
    case 'audio/wav':
    case 'audio/x-wav':
      return text(0, 4) === 'RIFF' && text(8, 12) === 'WAVE';
    case 'audio/mpeg':
      return text(0, 3) === 'ID3' || (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0);
    default:
      return false;
  }
}
function wave(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(pcm.length + 36, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Decode a bounded recording, count actual samples, and produce a provider-compatible WAV. */
export async function normalizeRecording(
  audio: AudioData,
  config: Config,
  signal: AbortSignal,
): Promise<AudioData & { durationMs: number }> {
  signal.throwIfAborted();
  if (!audio.bytes.length || audio.bytes.length > config.MAX_UPLOAD_BYTES)
    throw new AudioInputError('INVALID_REQUEST', '录音大小不正确，请重新录制。');
  if (!matchesContainer(audio))
    throw new AudioInputError('UNSUPPORTED_AUDIO', '录音格式与内容不匹配，可以先打字。');
  if (decoding >= DECODER_LIMIT)
    throw new AudioInputError('CAPACITY_EXCEEDED', '录音处理有些忙，请稍后再试。');
  decoding += 1;
  try {
    const pcm = await new Promise<Buffer>((resolve, reject) => {
      // No shell, URLs, file paths or container-supplied protocols are accepted.
      const child = spawn(
        config.FFMPEG_PATH,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-nostdin',
          '-max_alloc',
          '16777216',
          '-threads',
          '1',
          '-protocol_whitelist',
          'pipe',
          '-format_whitelist',
          'matroska,webm,mov,mp4,m4a,3gp,3g2,mj2,ogg,wav,mp3',
          '-probesize',
          String(config.MAX_UPLOAD_BYTES),
          '-analyzeduration',
          '2000000',
          '-i',
          'pipe:0',
          '-map',
          '0:a:0',
          '-vn',
          '-sn',
          '-dn',
          '-ac',
          '1',
          '-ar',
          String(SAMPLE_RATE),
          '-threads',
          '1',
          '-c:a',
          'pcm_s16le',
          '-f',
          's16le',
          'pipe:1',
        ],
        { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
      );
      const chunks: Buffer[] = [];
      let total = 0,
        stderrBytes = 0;
      let failure: unknown;
      // 250 ms permits bounded encoder padding; duration is measured, never client-declared.
      const maxBytes = (config.MAX_RECORDING_SECONDS + 0.25) * SAMPLE_RATE * 2;
      const stop = (error: unknown) => {
        if (!failure) failure = error;
        child.kill('SIGKILL');
        child.stdin.destroy();
      };
      const abort = () => stop(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(
        () => stop(new AudioInputError('INVALID_REQUEST', '录音处理超时，请缩短录音或先打字。')),
        DECODER_TIMEOUT_MS,
      );
      timeout.unref();
      const cleanup = () => {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
      };
      child.stdout.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes)
          stop(new AudioInputError('INVALID_REQUEST', '录音超过时长上限，请缩短后重试。'));
        else chunks.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes > 4096)
          stop(new AudioInputError('UNSUPPORTED_AUDIO', '录音无法解码，请重新录制或先打字。'));
      });
      child.stdin.on('error', () => {
        /* EPIPE after process exit is handled by close/error below. */
      });
      child.once('error', () => {
        cleanup();
        reject(new AudioInputError('UNSUPPORTED_AUDIO', '录音处理组件不可用，可以先打字。'));
      });
      child.once('close', (code) => {
        cleanup();
        if (failure) {
          reject(failure);
          return;
        }
        if (code !== 0 || total < SAMPLE_RATE * 2 * 0.2 || total % 2) {
          reject(new AudioInputError('INVALID_REQUEST', '没有收到有效录音，请重新录制。'));
          return;
        }
        resolve(Buffer.concat(chunks, total));
      });
      if (signal.aborted) abort();
      else child.stdin.end(audio.bytes);
    });
    signal.throwIfAborted();
    return {
      bytes: wave(pcm),
      mimeType: 'audio/wav',
      durationMs: (pcm.length / (SAMPLE_RATE * 2)) * 1000,
    };
  } finally {
    decoding -= 1;
  }
}
