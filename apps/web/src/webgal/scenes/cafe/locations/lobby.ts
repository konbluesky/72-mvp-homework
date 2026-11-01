import metadata from '../manifest.generated.json';
import type { LocationDefinition } from '../../location.js';
export const lobby: LocationDefinition = {
  label: metadata.locations['lobby'],
  description: '搬迁纸箱堆在吧台前。米拉似乎还在等人。',
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
