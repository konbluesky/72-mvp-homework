import metadata from '../manifest.generated.json';
import type { LocationDefinition } from '../../location.js';
export const cafeFront: LocationDefinition = {
  label: metadata.locations['cafe-front'],
  description: '雨棚挡住一部分雨声。营业牌仍朝外，隔着玻璃能看见独坐的身影；先决定要不要推门。',
  x: 1650,
  y: 1440,
  height: 1410,
  visible: true,
  background: { id: 'cafe-front', url: '/assets/cafe-story/cafe-front.webp' },
  outdoor: true,
  anchors: { 'inspect-notice': [930, 710] },
  closedBackground: { id: 'cafe-front-closed', url: '/assets/cafe-story/cafe-front-closed.webp' },
};
