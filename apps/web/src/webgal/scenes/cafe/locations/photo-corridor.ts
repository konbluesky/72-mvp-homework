import metadata from '../manifest.generated.json';
import type { LocationDefinition } from '../../location.js';
export const photoCorridor: LocationDefinition = {
  label: metadata.locations['photo-corridor'],
  description: '旅行纪念海报与空相框的浅痕。走到这里，谈话也可以从玩笑转向认真。',
  x: 1940,
  y: 1440,
  height: 1390,
  visible: true,
  background: { id: 'photo-corridor', url: '/assets/cafe-story/photo-corridor.webp' },
  outdoor: false,
  anchors: { 'inspect-exhibition': [320, 680] },
};
