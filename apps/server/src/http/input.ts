import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { AudioInputMetadataSchema, JsonInputSchema } from '@mira/protocol';
import type { Config } from '../config/index.js';
import type { TurnInput } from '../graphs/conversation.js';
import { AppError } from './errors.js';

const MIME_TYPES = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/wav',
  'audio/x-wav',
  'audio/mpeg',
]);
export interface ParsedInput {
  generation: number;
  inputId: string;
  digest: string;
  contentDigest?: string;
  input: TurnInput;
}

export async function readInput(request: FastifyRequest, config: Config): Promise<ParsedInput> {
  if (!request.isMultipart()) {
    const parsed = JsonInputSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError('INVALID_REQUEST', 400, '请输入一段简短的话。');
    return {
      generation: parsed.data.generation,
      inputId: parsed.data.inputId,
      digest: createHash('sha256').update(JSON.stringify(parsed.data)).digest('hex'),
      contentDigest: createHash('sha256')
        .update(
          JSON.stringify(
            'interaction' in parsed.data
              ? { interaction: parsed.data.interaction }
              : 'media' in parsed.data
                ? { media: parsed.data.media }
                : { text: parsed.data.text },
          ),
        )
        .digest('hex'),
      input:
        'interaction' in parsed.data
          ? { kind: 'interaction', interaction: parsed.data.interaction }
          : 'media' in parsed.data
            ? { kind: 'media', media: parsed.data.media }
            : { kind: 'text', text: parsed.data.text },
    };
  }
  let metadata: unknown;
  let audio: { bytes: Uint8Array; mimeType: string } | undefined;
  for await (const part of request.parts({
    limits: { files: 1, fields: 1, parts: 2, fileSize: config.MAX_UPLOAD_BYTES, fieldSize: 2048 },
  })) {
    if (part.type === 'field') {
      if (part.fieldname !== 'metadata' || typeof part.value !== 'string' || metadata !== undefined)
        throw new AppError('INVALID_REQUEST', 400, '录音信息不完整，请重新录制。');
      try {
        metadata = JSON.parse(part.value);
      } catch {
        throw new AppError('INVALID_REQUEST', 400, '录音信息不完整，请重新录制。');
      }
    } else {
      const mimeType = part.mimetype.split(';')[0]?.toLowerCase() ?? '';
      if (part.fieldname !== 'audio' || audio || !MIME_TYPES.has(mimeType)) {
        part.file.destroy();
        throw new AppError('UNSUPPORTED_AUDIO', 415, '浏览器的录音格式暂不支持，可以先打字。');
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of part.file) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > config.MAX_UPLOAD_BYTES) {
          part.file.destroy();
          throw new AppError('UPLOAD_TOO_LARGE', 413, '录音太大，请缩短后重试。');
        }
        chunks.push(bytes);
      }
      if (part.file.truncated)
        throw new AppError('UPLOAD_TOO_LARGE', 413, '录音太大，请缩短后重试。');
      if (size < 32) throw new AppError('INVALID_REQUEST', 400, '没有收到有效录音，请再试一次。');
      audio = { bytes: Buffer.concat(chunks), mimeType };
    }
  }
  const parsed = AudioInputMetadataSchema.safeParse(metadata);
  if (!parsed.success || !audio || parsed.data.durationMs > config.MAX_RECORDING_SECONDS * 1000)
    throw new AppError('INVALID_REQUEST', 400, '录音时间或信息不完整，请重新录制。');
  const digest = createHash('sha256')
    .update(`audio:${audio.mimeType}:${parsed.data.durationMs}:`)
    .update(audio.bytes)
    .digest('hex');
  return {
    generation: parsed.data.generation,
    inputId: parsed.data.inputId,
    digest,
    contentDigest: digest,
    input: { kind: 'audio', ...audio },
  };
}
