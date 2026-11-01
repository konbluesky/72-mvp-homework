import metadata from '../manifest.generated.json';
import type { LocationDefinition } from '../../location.js';
export const cafeFront: LocationDefinition = {
  label: metadata.locations['cafe-front'],
  description: '门铃旁贴着旧店最后营业日的告示。',
  x: 1650,
  y: 1440,
  height: 1410,
  visible: true,
  background: { id: 'cafe-front', url: '/assets/cafe-story/cafe-front.svg' },
  outdoor: true,
  anchors: { 'inspect-notice': [450, 800] },
  closedBackground: { id: 'cafe-front-closed', url: '/assets/cafe-story/cafe-front-closed.svg' },
};
