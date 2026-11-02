import metadata from '../manifest.generated.json';
import type { LocationDefinition } from '../../location.js';
export const photoCorridor: LocationDefinition = {
  label: metadata.locations['photo-corridor'],
  description: '墙上的无署名风景画映在暖光里。走廊安静些，可以看看画，也可以继续聊天。',
  x: 1940,
  y: 1440,
  height: 1390,
  visible: true,
  background: { id: 'photo-corridor', url: '/assets/cafe-story/photo-corridor.webp' },
  outdoor: false,
  anchors: { 'inspect-wall-art': [320, 680] },
};
