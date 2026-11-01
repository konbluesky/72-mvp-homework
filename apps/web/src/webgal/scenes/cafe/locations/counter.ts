import metadata from '../manifest.generated.json';
import { drawCounter } from './foreground.js';
import type { LocationDefinition } from '../../location.js';
export const counter: LocationDefinition = {
  label: metadata.locations['counter'],
  description: '托盘旁放着一封写给米拉的信。',
  x: 1040,
  y: 1700,
  height: 1750,
  visible: true,
  rain: [1550, 0, 1010, 830],
  background: { id: 'counter', url: '/assets/cafe-story/counter.webp' },
  lookDirection: 1,
  foreground: drawCounter,
  outdoor: false,
  anchors: { 'inspect-letter': [1670, 1040], 'inspect-reply': [1880, 1120] },
};
