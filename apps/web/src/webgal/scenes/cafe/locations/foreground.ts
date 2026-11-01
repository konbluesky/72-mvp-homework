import type { Graphics } from 'pixi.js';
import type { StoryState } from '@mira/protocol';
export function drawCafeAmbience(g: Graphics, story: StoryState) {
  if (story.ambience === 'last-lamp')
    g.beginFill(0x071c28, 0.38).drawRect(0, 0, 2560, 1440).endFill();
}
export function drawWindowSeat(g: Graphics, story: StoryState) {
  g.beginFill(0x876744).drawPolygon([760, 1200, 1900, 1200, 2110, 1440, 530, 1440]).endFill();
  drawCafeAmbience(g, story);
  if (story.ambience === 'last-lamp')
    g.beginFill(0xf6ce82, 0.16).drawEllipse(1020, 1180, 270, 180).endFill();
  g.lineStyle(12, 0xb69a68).moveTo(1020, 1120).lineTo(1020, 1270);
  g.lineStyle(0)
    .beginFill(story.ambience === 'last-lamp' ? 0xf3d399 : 0x8f8767)
    .drawPolygon([960, 1000, 1080, 1000, 1130, 1120, 910, 1120])
    .endFill();
  g.beginFill(0xad9875).drawEllipse(1020, 1270, 95, 18).endFill();
}
export function drawCounter(g: Graphics, story: StoryState) {
  g.beginFill(0x97754e).drawRect(180, 1120, 2200, 320).endFill();
  drawCafeAmbience(g, story);
  if (story.revealed.includes('reply')) {
    g.beginFill(0xf1dfb2).drawRoundedRect(1740, 1060, 300, 150, 8).endFill();
    g.lineStyle(4, 0x8e7661)
      .moveTo(1780, 1100)
      .lineTo(2000, 1100)
      .moveTo(1780, 1140)
      .lineTo(1940, 1140);
  }
}
export function drawWashroom(g: Graphics, story: StoryState) {
  g.beginFill(0x9f9f8b).drawRect(290, 1180, 1700, 260).endFill();
  g.beginFill(0xcbd1ba).drawPolygon([500, 1200, 820, 1190, 880, 1370, 530, 1380]).endFill();
  g.lineStyle(4, 0x8d9f93).moveTo(560, 1220).lineTo(820, 1350);
  drawCafeAmbience(g, story);
}
