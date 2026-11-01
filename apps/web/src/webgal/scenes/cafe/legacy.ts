import type { LegacySceneModule } from '../legacy-module.js';
import metadata from './manifest.generated.json';
import { cafeResource, CAFE_PHOTO_DESCRIPTION } from './resources.js';
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
  photo: {
    url: cafeResource('travel_photo_01').url,
    alt: CAFE_PHOTO_DESCRIPTION.alt,
    caption: CAFE_PHOTO_DESCRIPTION.title,
  },
  about: {
    title: '今晚没有返程',
    description:
      '旧店最后营业的雨夜，刚结束执勤的空乘米拉邀你在窗边坐坐。从一句玩笑到认真认识彼此，这一晚可以慢慢聊，也可以好好告别。完整的两次见面在故事页继续。',
    attribution:
      'Haru 为 Live2D 官方样例，作为原创成年角色米拉的表演替身。当前照片为独立场景道具，样例不含专用递照片动作。',
  },
  backdrop: LegacyBackdrop,
  createPresentation,
};
