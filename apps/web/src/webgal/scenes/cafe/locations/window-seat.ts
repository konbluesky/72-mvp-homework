import metadata from '../manifest.generated.json';
import { drawWindowSeat } from './foreground.js';
import type { LocationDefinition } from '../../location.js';
export const windowSeat: LocationDefinition = {
  label: metadata.locations['window-seat'],
  description: '一张海岸照片，一个尚未坐下的人。',
  x: 1640,
  y: 2130,
  height: 1810,
  visible: true,
  rain: [380, 100, 1760, 910],
  background: { id: 'window-seat', url: '/assets/cafe-story/window-seat.svg' },
  lookDirection: -1,
  lookWindowCamera: true,
  foreground: drawWindowSeat,
  outdoor: false,
  anchors: { 'view-photo': [1000, 1250] },
};
