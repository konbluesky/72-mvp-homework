import metadata from '../manifest.generated.json';
import type { LocationDefinition } from '../../location.js';
export const streetWalk: LocationDefinition = {
  label: metadata.locations['street-walk'],
  description: '走到路灯下，再回头看一眼旧店。',
  x: 1680,
  y: 1440,
  height: 1320,
  visible: true,
  background: { id: 'street-walk', url: '/assets/cafe-story/street-walk.svg' },
  outdoor: true,
  anchors: {},
  closedBackground: { id: 'street-walk-closed', url: '/assets/cafe-story/street-walk-closed.svg' },
};
