import type { LegacySceneModule } from '../legacy-module.js';
import metadata from './manifest.generated.json';
import { cafeResource } from './resources.js';
import { createPresentation } from './legacy-presentation.js';
import LegacyBackdrop from './LegacyBackdrop.vue';

export const cafeLegacyScene: LegacySceneModule = {
  id: metadata.id,
  version: metadata.version,
  title: metadata.title,
  speaker: metadata.speaker,
  speakerDescription: metadata.speakerDescription,
  opening: '雨这么大，先坐一会儿吧。',
  locationLabel: '巷口咖啡馆',
  environmentLabel: (environment) => (environment === 'rain-soft' ? '雨渐歇' : '深夜 · 有雨'),
  photo: {
    url: cafeResource('travel_photo_01').url,
    alt: '明亮天空下的海岸，蓝绿色海面与岸边的白色浪花',
    caption: '海边的一天',
  },
  about: {
    title: '一场雨，一次偶遇。',
    description: '深夜的咖啡馆快打烊了。米拉把相机放在桌边，面前的咖啡已经凉了一半。',
    attribution:
      'Haru 为 Live2D 官方样例，作为原创成年角色米拉的表演替身。当前照片为独立场景道具，样例不含专用递照片动作。',
  },
  backdrop: LegacyBackdrop,
  createPresentation,
};
