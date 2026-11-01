import metadata from '../manifest.generated.json';
import { drawWindowSeat } from './foreground.js';
import type { LocationDefinition } from '../../location.js';
export const windowSeat: LocationDefinition = {
  label: metadata.locations['window-seat'],
  description: '放凉的咖啡、雨窗上的倒影。玩笑、试探和真心话，都可以慢慢说。',
  x: 1640,
  y: 2130,
  height: 1810,
  visible: true,
  rain: [180, 0, 1640, 850],
  background: { id: 'window-seat', url: '/assets/cafe-story/window-seat.webp' },
  lookDirection: -1,
  lookWindowCamera: true,
  foreground: drawWindowSeat,
  outdoor: false,
  anchors: { 'view-photo': [1000, 1250] },
};
