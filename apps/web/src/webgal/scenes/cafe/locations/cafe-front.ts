import metadata from '../manifest.generated.json';
import type { LocationDefinition } from '../../location.js';
export const cafeFront: LocationDefinition = {
  label: metadata.locations['cafe-front'],
  description: '门铃、雨棚和营业牌。进门、告别，或另一次专门的见面，都从这里开始。',
  x: 1650,
  y: 1440,
  height: 1410,
  visible: true,
  background: { id: 'cafe-front', url: '/assets/cafe-story/cafe-front.webp' },
  outdoor: true,
  anchors: { 'inspect-notice': [930, 710] },
  closedBackground: { id: 'cafe-front-closed', url: '/assets/cafe-story/cafe-front-closed.webp' },
};
