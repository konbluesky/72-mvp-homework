import { initialConnectionView } from '../connection/monitor.js';
import {
  initialStory,
  type Action,
  type Emotion,
  type Facts,
  type Interaction,
  type ReplySuggestion,
  type SessionOpening,
} from '@mira/protocol';
import type { PlaybackMode } from '../playback/scheduler.js';
import type { RecordingPhase } from './recorder.js';
import type { OutgoingMessage } from './messages.js';

/** Shared headless projection, used by both Vue compatibility and the WebGAL host. */
export function initialInteractiveState() {
  return {
    imageShares: {} as Record<string, import('./conversation-items.js').ImageShareView>,
    imageItems: [] as import('./conversation-items.js').ImageShareItem[],
    connected: false,
    sessionExpired: false,
    connection: initialConnectionView(),
    connecting: false,
    mode: 'mock' as 'mock' | 'live',
    voiceInput: false,
    interaction: 'idle' as Interaction,
    emotion: 'guarded' as Emotion,
    action: 'none' as Action,
    mouthOpen: 0,
    subtitle: '',
    narration: '',
    opening: null as SessionOpening | null,
    suggestions: [] as ReplySuggestion[],
    playback: 'idle' as PlaybackMode,
    recording: 'idle' as RecordingPhase,
    voicePreview: 'idle' as 'idle' | 'transcribing' | 'ready',
    voiceDraft: '',
    voiceInputError: '',
    voiceDraftSimulated: false,
    documentTitle: '',
    documentText: '',
    photo: 'hidden' as 'hidden' | 'loading' | 'visible' | 'failed',
    scenario: null as { id: string; version: string } | null,
    environment: 'default',
    facts: {} as Facts,
    story: initialStory(),
    transcribed: '',
    simulated: false,
    failure: '',
    outgoing: [] as OutgoingMessage[],
    activeMessageId: '',
    retryingMessageId: '',
    animation: 'loading' as 'loading' | 'live2d' | 'failed' | 'suspended',
  };
}
export type InteractiveState = ReturnType<typeof initialInteractiveState>;
