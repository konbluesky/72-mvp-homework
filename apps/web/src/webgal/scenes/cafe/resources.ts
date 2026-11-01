import metadata from './manifest.generated.json';
import type { LocalStageAsset } from '../../runtime/visual-port.js';

/** Shared public resource bindings; importing these never loads a rendering engine. */
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
