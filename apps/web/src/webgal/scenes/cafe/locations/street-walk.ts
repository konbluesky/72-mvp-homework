import metadata from '../manifest.generated.json';
import type { LocationDefinition } from '../../location.js';
export const streetWalk: LocationDefinition = {
  label: metadata.locations['street-walk'],
  description: '路灯映着湿路面。并肩走一段，把舍不得和接下来的选择慢慢说清楚。',
  x: 1680,
  y: 1440,
  height: 1320,
  visible: true,
  background: { id: 'street-walk', url: '/assets/cafe-story/street-walk.webp' },
  outdoor: true,
  anchors: {},
  closedBackground: { id: 'street-walk-closed', url: '/assets/cafe-story/street-walk-closed.webp' },
};
