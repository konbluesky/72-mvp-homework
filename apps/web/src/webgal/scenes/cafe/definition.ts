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
export function cafeLocation(id: string): LocationDefinition {
  const location = Object.hasOwn(LOCATIONS, id) ? LOCATIONS[id] : undefined;
  if (!location) throw new Error('CAFE_LOCATION_NOT_REGISTERED');
  return location;
}
export const CAFE_RESOURCES: Readonly<Record<string, LocalStageAsset>> = Object.fromEntries(
  Object.entries(metadata.resources).map(([id, resource]) => [
    id,
    { id: resource.asset, url: resource.url },
  ]),
);
export function cafeResource(id: string): LocalStageAsset {
  const resource = Object.hasOwn(CAFE_RESOURCES, id) ? CAFE_RESOURCES[id] : undefined;
  if (!resource) throw new Error('CAFE_RESOURCE_NOT_REGISTERED');
  return resource;
}
export const CAFE_ASSETS: readonly LocalStageAsset[] = [
  ...Object.values(LOCATIONS).flatMap((location) => [
    location.background,
    ...(location.closedBackground ? [location.closedBackground] : []),
  ]),
  ...Object.values(CAFE_RESOURCES),
];
export function stageScene(story: StoryState, environment: string): StageScene {
  const location = cafeLocation(story.location);
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
export function sceneActionAnchor(location: string, actionId: string) {
  return cafeLocation(location).anchors[actionId];
}
