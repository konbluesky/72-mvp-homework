import { ProviderError, type AudioData } from '../providers/types.js';

export function validateAudio(audio: AudioData): void {
  const mime = audio.mimeType.split(';')[0];
  const b = audio.bytes;
  const isMp3 =
    b.length > 3 &&
    ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) ||
      (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0));
  const isWave =
    b.length > 44 &&
    new TextDecoder().decode(b.subarray(0, 4)) === 'RIFF' &&
    new TextDecoder().decode(b.subarray(8, 12)) === 'WAVE';
  if (!(
    (mime === 'audio/mpeg' && isMp3) ||
    ((mime === 'audio/wav' || mime === 'audio/x-wav') && isWave)
  ))
    throw new ProviderError('INVALID_AUDIO', '声音暂时无法播放，可以用字幕继续。');
}
