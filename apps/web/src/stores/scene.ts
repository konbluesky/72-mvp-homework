import { defineStore } from 'pinia';
import type { Action, Emotion, Facts, Interaction } from '@mira/protocol';
import type { PlaybackMode } from '../playback/scheduler.js';
import type { RecordingPhase } from '../interaction/recorder.js';

export const useSceneStore = defineStore('scene', {
  state: () => ({
    connected: false,
    connecting: false,
    mode: 'mock' as 'mock' | 'live',
    voiceInput: false,
    interaction: 'idle' as Interaction,
    emotion: 'guarded' as Emotion,
    action: 'none' as Action,
    mouthOpen: 0,
    subtitle: '',
    playback: 'idle' as PlaybackMode,
    recording: 'idle' as RecordingPhase,
    photo: 'hidden' as 'hidden' | 'loading' | 'visible' | 'failed',
    environment: 'rain' as 'rain' | 'rain-soft',
    facts: { photo_revealed: false, rain_softened: false } as Facts,
    transcribed: '',
    simulated: false,
    failure: '',
    animation: 'loading' as 'loading' | 'live2d' | 'failed' | 'suspended',
  }),
  getters: {
    stateLabel: (state) => {
      if (state.recording === 'permission') return '正在请求麦克风';
      if (state.playback === 'text') return '字幕模式';
      if (state.playback === 'audio-error') return '声音暂不可用';
      if (state.connecting) return '正在连接';
      if (!state.connected) return '等待重新连接';
      return {
        idle: '等待你开口',
        listening: '正在听你说',
        thinking: '她想了想…',
        speaking: '正在说话',
      }[state.interaction];
    },
  },
});
export type SceneStore = ReturnType<typeof useSceneStore>;
