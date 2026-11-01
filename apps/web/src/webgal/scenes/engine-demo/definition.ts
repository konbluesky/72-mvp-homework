import type { LocalStageAsset, StageScene } from '../../runtime/visual-port';

export const DEMO_ASSETS: readonly LocalStageAsset[] = [
  { id: 'cafe-night', url: '/assets/webgal-demo/cafe-night.svg' },
  { id: 'cafe-dusk', url: '/assets/webgal-demo/cafe-dusk.svg' },
];

export const DEMO_SCENES = [
  {
    id: 'night',
    label: '雨夜咖啡馆',
    description: '暖光、城市夜色与 WebGAL 原生雨效。',
    background: 'cafe-night',
    effects: ['rain'],
    zoom: 1,
  },
  {
    id: 'dusk',
    label: '雨后的傍晚',
    description: '切换背景资源，停止雨粒子，保留同一舞台。',
    background: 'cafe-dusk',
    effects: [],
    zoom: 1,
  },
] as const satisfies readonly (StageScene & { id: string; label: string; description: string })[];
