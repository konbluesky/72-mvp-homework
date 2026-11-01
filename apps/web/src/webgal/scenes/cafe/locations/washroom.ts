import metadata from '../manifest.generated.json';
import { drawWashroom } from './foreground.js';
import type { LocationDefinition } from '../../location.js';
export const washroom: LocationDefinition = {
  label: metadata.locations['washroom'],
  description: '镜中有门外的暖光。玩笑可以放轻，话也可以直接说。',
  x: 1610,
  y: 1610,
  height: 1670,
  visible: true,
  background: { id: 'washroom', url: '/assets/cafe-story/washroom.webp' },
  foreground: drawWashroom,
  outdoor: false,
  anchors: {},
};
