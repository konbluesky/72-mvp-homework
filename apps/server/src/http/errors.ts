import type { PublicError } from '@mira/protocol';
import { ProviderError } from '../providers/types.js';
import { AudioInputError } from '../providers/audio-input.js';
import { MediaError } from '../media/index.js';

export class AppError extends Error {
  constructor(
    readonly code: PublicError['code'],
    readonly status: number,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function publicError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof AudioInputError)
    return new AppError(
      error.code,
      error.code === 'CAPACITY_EXCEEDED' ? 429 : error.code === 'UNSUPPORTED_AUDIO' ? 415 : 400,
      error.message,
      true,
    );
  if (error instanceof ProviderError) {
    if (error.code === 'NO_SPEECH')
      return new AppError('INVALID_REQUEST', 400, '刚才没有听清，请再说一次或使用文字。', true);
    return new AppError(
      error.code === 'INVALID_AUDIO' ? 'MEDIA_FAILED' : error.code,
      error.code === 'PROVIDER_TIMEOUT' ? 504 : 502,
      '回应暂时没有准备好，请再试一次。',
      error.retryable,
    );
  }
  if (error instanceof MediaError)
    return new AppError(
      error.code,
      error.code === 'MEDIA_NOT_FOUND' ? 404 : error.code === 'CAPACITY_EXCEEDED' ? 503 : 502,
      '声音暂时无法读取，请再试一次。',
      true,
    );
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return new AppError('TURN_CANCELLED', 409, '这次回应已经结束，请重新开始。', true);
  }
  return new AppError('PROVIDER_FAILED', 502, '回应暂时没有准备好，请再试一次。', true);
}
