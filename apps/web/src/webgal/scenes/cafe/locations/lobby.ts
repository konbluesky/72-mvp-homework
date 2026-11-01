import metadata from '../manifest.generated.json';
import type { LocationDefinition } from '../../location.js';
export const lobby: LocationDefinition = {
  label: metadata.locations['lobby'],
  description: '搬迁纸箱靠在吧台边。米拉用一句玩笑，给你留了个位置。',
  x: 1190,
  y: 1440,
  height: 1420,
  visible: true,
  rain: [0, 0, 600, 850],
  background: { id: 'lobby', url: '/assets/cafe-story/lobby.webp' },
  lookDirection: -1,
  outdoor: false,
  anchors: { 'inspect-notice': [450, 800] },
};
