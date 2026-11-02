import metadata from '../manifest.generated.json';
import { drawCounter } from './foreground.js';
import type { LocationDefinition } from '../../location.js';
export const counter: LocationDefinition = {
  label: metadata.locations['counter'],
  description: '吧台上摆着饮品单，收银台旁留着放杯碟的位置。可以看看喝的东西，再决定是否点单。',
  x: 1040,
  y: 1700,
  height: 1750,
  visible: true,
  rain: [1550, 0, 1010, 830],
  background: { id: 'counter', url: '/assets/cafe-story/counter.webp' },
  lookDirection: 1,
  foreground: drawCounter,
  outdoor: false,
  anchors: { 'inspect-menu': [1670, 1040] },
};
