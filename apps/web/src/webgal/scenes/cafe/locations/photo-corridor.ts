import metadata from '../manifest.generated.json';
import type { LocationDefinition } from '../../location.js';
export const photoCorridor: LocationDefinition = {
  label: metadata.locations['photo-corridor'],
  description: '相框取走后，墙上还留着旅行纪念海报。',
  x: 1940,
  y: 1440,
  height: 1390,
  visible: true,
  background: { id: 'photo-corridor', url: '/assets/cafe-story/photo-corridor.webp' },
  outdoor: false,
  anchors: { 'inspect-exhibition': [320, 680] },
};
