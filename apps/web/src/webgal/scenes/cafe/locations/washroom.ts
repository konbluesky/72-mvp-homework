import metadata from '../manifest.generated.json';
import { drawWashroom } from './foreground.js';
import type { LocationDefinition } from '../../location.js';
export const washroom: LocationDefinition = {
  label: metadata.locations['washroom'],
  description: '门外还有雨声。她终于愿意说说自己的犹豫。',
  x: 1610,
  y: 1610,
  height: 1670,
  visible: true,
  background: { id: 'washroom', url: '/assets/cafe-story/washroom.webp' },
  foreground: drawWashroom,
  outdoor: false,
  anchors: {},
};
