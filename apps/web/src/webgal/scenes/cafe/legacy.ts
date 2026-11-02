import type { LegacySceneModule } from '../legacy-module.js';
import metadata from './manifest.generated.json';
import { createPresentation } from './legacy-presentation.js';
import LegacyBackdrop from './LegacyBackdrop.vue';

export const cafeLegacyScene: LegacySceneModule = {
  id: metadata.id,
  version: metadata.version,
  title: metadata.title,
  speaker: metadata.speaker,
  speakerDescription: metadata.speakerDescription,
  opening: metadata.opening,
  locationLabel: '巷口咖啡馆',
  environmentLabel: (environment) => (environment === 'rain-soft' ? '雨渐歇' : '深夜 · 有雨'),
  about: {
    title: '今晚没有返程',
    description:
      '旧店最后营业的雨夜，你与刚下班的米拉第一次共桌。从一句普通招呼开始，彼此愿意再聊，才慢慢熟悉。完整的两次见面在故事页继续。',
    attribution:
      'Haru 为 Live2D 官方样例，作为原创成年角色米拉的表演替身。场景素材与角色模型分别提供。',
  },
  backdrop: LegacyBackdrop,
  createPresentation,
};
