import type { Config } from '../config/index.js';
import {
  ProviderError,
  type AudioData,
  type ProviderSet,
  type Transcription,
} from '../providers/types.js';
import { normalizeRecording } from '../providers/audio-input.js';
import { AppError } from '../http/errors.js';
import { timed, type StageLogger } from '../observability/stages.js';
import type { Session, SessionManager, Turn } from '../sessions/manager.js';
import { abortable } from './abortable.js';

/** Shared recognition boundary. Preview never creates messages, plans, media or scene facts. */
export async function transcribeRecording(
  dependencies: {
    config: Config;
    providers: ProviderSet;
    sessions: SessionManager;
    logger: StageLogger;
  },
  session: Session,
  turn: Turn,
  audio: AudioData,
): Promise<Transcription> {
  const { config, providers, sessions, logger } = dependencies;
  const active = () => sessions.assertCurrent(session, turn);
  const signal = turn.abort.signal;
  const stage = <T>(name: string, operation: () => Promise<T>) =>
    timed(logger, turn.identity, name, async () => {
      active();
      const value = await abortable(operation(), signal);
      active();
      return value;
    });
  if (!providers.stt)
    throw new AppError('UNSUPPORTED_AUDIO', 415, '当前模式暂不支持语音输入，请使用文字输入。');
  const stt = providers.stt;
  const normalized = await stage('recording_decode', () =>
    normalizeRecording(audio, config, signal),
  );
  logger.info({
    ...turn.identity,
    stage: 'recording',
    durationMs: normalized.durationMs,
    inputBytes: audio.bytes.length,
    sampleRate: 16000,
    audioSignal: normalized.signalStats,
  });
  logger.info({ ...turn.identity, stage: 'stt_provider', ...stt.info });
  let transcription: Transcription;
  try {
    transcription = await stage('stt', () => stt.transcribe(normalized, signal));
  } catch (error) {
    if (
      error instanceof ProviderError &&
      error.code === 'NO_SPEECH' &&
      normalized.signalStats.silent
    )
      throw new AppError(
        'NO_SPEECH',
        422,
        '录音中没有收到声音，请检查麦克风输入设备后重录，或使用文字。',
        true,
      );
    throw error;
  }
  const text = transcription.text.trim();
  logger.info({
    ...turn.identity,
    stage: 'stt_result',
    providerRequestId: transcription.requestId ?? 'unknown',
    audioDurationSeconds: transcription.durationSeconds ?? 'unknown',
  });
  if (!text)
    throw new AppError(
      'NO_SPEECH',
      422,
      '没有识别出语音，请检查麦克风输入后重录，或使用文字。',
      true,
    );
  if (text.length > 1000)
    throw new AppError('PROVIDER_FAILED', 502, '识别结果格式异常，请重新录音或使用文字。', true);
  return { ...transcription, text };
}
