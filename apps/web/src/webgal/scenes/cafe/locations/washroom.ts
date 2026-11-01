import metadata from '../manifest.generated.json';
import { drawWashroom } from './foreground.js';
import type { LocationDefinition } from '../../location.js';
export const washroom: LocationDefinition = {
  label: metadata.locations['washroom'],
  description: '镜前可以整理妆容，门外仍有雨声。那些没说出口的话，暂时留给独处的片刻。',
  x: 1610,
  y: 1610,
  height: 1670,
  visible: true,
  background: { id: 'washroom', url: '/assets/cafe-story/washroom.webp' },
  foreground: drawWashroom,
  outdoor: false,
  anchors: {},
};
