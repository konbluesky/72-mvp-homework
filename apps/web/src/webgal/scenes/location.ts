import type { StoryState } from '@mira/protocol';
import type { Graphics, Texture } from 'pixi.js';
import type { LocalStageAsset } from '../runtime/visual-port.js';
export interface LocationDefinition {
  label: string;
  description: string;
  background: LocalStageAsset;
  closedBackground?: LocalStageAsset;
  x: number;
  y: number;
  height: number;
  visible: boolean;
  outdoor: boolean;
  lookDirection?: number;
  lookWindowCamera?: boolean;
  rain?: readonly [number, number, number, number];
  anchors: Readonly<Record<string, readonly [number, number]>>;
  foreground?(graphics: Graphics, state: StoryState, background: Texture): void;
}

/** Fail early when authored IDs and local rendering bindings drift. */
export function defineLocations(
  labels: Readonly<Record<string, string>>,
  locations: Record<string, LocationDefinition>,
): Readonly<Record<string, LocationDefinition>> {
  const expected = Object.keys(labels);
  if (
    expected.some((id) => !Object.hasOwn(locations, id)) ||
    Object.keys(locations).some((id) => !Object.hasOwn(labels, id))
  )
    throw new Error('SCENE_LOCATION_BINDINGS_MISMATCH');
  return locations;
}
