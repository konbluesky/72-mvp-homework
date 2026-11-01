import metadata from '../manifest.generated.json';
import { drawWindowSeat } from './foreground.js';
import type { LocationDefinition } from '../../location.js';
export const windowSeat: LocationDefinition = {
  label: metadata.locations['window-seat'],
  description: '咖啡、雨窗和倒影。刚好容得下两个人慢慢说话。',
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
