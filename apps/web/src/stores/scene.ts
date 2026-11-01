import { defineStore } from 'pinia';
import { initialInteractiveState } from '../interaction/state.js';

export const useSceneStore = defineStore('scene', {
  state: initialInteractiveState,
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
        thinking: '正在思考…',
        speaking: '正在说话',
      }[state.interaction];
    },
  },
});
export type SceneStore = ReturnType<typeof useSceneStore>;
