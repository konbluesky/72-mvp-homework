import { Matrix, utils, type Graphics } from 'pixi.js';
import type { StoryState } from '@mira/protocol';

/** Reuse the background already loaded by the stage, with no extra texture or async work. */
function furnitureTexture(
  g: Graphics,
  name: 'window-seat' | 'counter' | 'washroom',
  outline: number[],
) {
  const texture = utils.TextureCache[`/assets/cafe-story/${name}.webp`];
  if (!texture?.baseTexture.valid) throw new Error('CAFE_FOREGROUND_TEXTURE_NOT_READY');
  g.lineStyle(0)
    .beginTextureFill({
      texture,
      matrix: new Matrix().scale(2560 / texture.width, 1440 / texture.height),
    })
    .drawPolygon(outline)
    .endFill();
}

export function drawCafeAmbience(g: Graphics, story: StoryState) {
  if (story.ambience === 'last-lamp')
    g.beginFill(0x071c28, 0.38).drawRect(0, 0, 2560, 1440).endFill();
}
export function drawWindowSeat(g: Graphics, story: StoryState) {
  furnitureTexture(
    g,
    'window-seat',
    [0, 1353, 812, 1068, 1010, 1054, 2560, 1160, 2560, 1440, 0, 1440],
  );
  drawCafeAmbience(g, story);
  if (story.ambience === 'last-lamp')
    g.beginFill(0xf6ce82, 0.12).drawEllipse(870, 1110, 280, 160).endFill();
}
export function drawCounter(g: Graphics, story: StoryState) {
  furnitureTexture(g, 'counter', [0, 976, 2560, 976, 2560, 1440, 0, 1440]);
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
  furnitureTexture(
    g,
    'washroom',
    [150, 960, 330, 885, 1870, 885, 2020, 960, 2020, 1440, 150, 1440],
  );
  drawCafeAmbience(g, story);
}
