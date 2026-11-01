import metadata from '../manifest.generated.json';
import type { LocationDefinition } from '../../location.js';
export const streetWide: LocationDefinition = {
  label: metadata.locations['street-wide'],
  description: '雨夜的街角，熟悉的店面。第一次是路过，再回来时可以有不同的理由。',
  x: 1740,
  y: 1440,
  height: 1370,
  visible: false,
  background: { id: 'street-wide', url: '/assets/cafe-story/street-wide.webp' },
  outdoor: true,
  anchors: {},
  closedBackground: { id: 'street-wide-closed', url: '/assets/cafe-story/street-wide-closed.webp' },
};
