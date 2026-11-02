import metadata from './manifest.generated.json';
import type { StoryState } from '@mira/protocol';
import { defineLocations, type LocationDefinition } from '../location.js';
import type { LocalStageAsset, StageScene } from '../../runtime/visual-port.js';
import { streetWide } from './locations/street-wide.js';
import { cafeFront } from './locations/cafe-front.js';
import { lobby } from './locations/lobby.js';
import { windowSeat } from './locations/window-seat.js';
import { photoCorridor } from './locations/photo-corridor.js';
import { washroom } from './locations/washroom.js';
import { counter } from './locations/counter.js';
import { streetWalk } from './locations/street-walk.js';
import { CAFE_RESOURCES } from './resources.js';

export const LOCATIONS = defineLocations(metadata.locations, {
  'street-wide': streetWide,
  'cafe-front': cafeFront,
  lobby,
  'window-seat': windowSeat,
  'photo-corridor': photoCorridor,
  washroom,
  counter,
  'street-walk': streetWalk,
});
export function cafeConversationAvailable(story: StoryState): boolean {
  return (
    story.milestones.includes('met') &&
    (story.milestones.includes('companionship') || story.location === 'lobby')
  );
}
export function cafeAdvanceAction(story: StoryState) {
  return (
    story.actions.find((action) => action.id === 'talk-next-scene') ??
    story.actions.find((action) => action.id === 'choose-reunion')
  );
}
export function cafeImageGeneration(story: StoryState) {
  const available =
    story.location === 'window-seat' &&
    story.milestones.includes('companionship') &&
    !story.ending &&
    (!story.shot || story.shot.mode === 'shared');
  return {
    label: '生成纪念照',
    available,
    hint: available ? '点击后开始准备，留在窗边可自动展示。' : '在窗边落座后可生成。',
  };
}
export function cafeLocation(id: string, story?: StoryState): LocationDefinition {
  const location = Object.hasOwn(LOCATIONS, id) ? LOCATIONS[id] : undefined;
  if (!location) throw new Error('CAFE_LOCATION_NOT_REGISTERED');
  if (story && !cafeConversationAvailable(story)) return { ...location, visible: false };
  return location;
}
export const CAFE_ASSETS: readonly LocalStageAsset[] = [
  ...Object.values(LOCATIONS).flatMap((location) => [
    location.background,
    ...(location.closedBackground ? [location.closedBackground] : []),
  ]),
  ...Object.values(CAFE_RESOURCES),
];
export function stageScene(story: StoryState, environment: string): StageScene {
  const location = cafeLocation(story.shot?.location ?? story.location);
  const background =
    story.ambience === 'closed' && location.closedBackground
      ? location.closedBackground
      : location.background;
  if (!['rain', 'rain-soft'].includes(environment))
    throw new Error('CAFE_ENVIRONMENT_NOT_REGISTERED');
  return {
    background: background.id,
    effects: location.outdoor || location.rain ? ['rain'] : [],
    zoom: 1,
    rainMask: location.rain,
    rainStrength: environment === 'rain-soft' ? 0.23 : 0.8,
  };
}
