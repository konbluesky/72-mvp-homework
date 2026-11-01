import metadata from './manifest.generated.json';
import type { LocalStageAsset } from '../../runtime/visual-port.js';

/** Visible image semantics only; story memories and knowledge remain server-owned. */
export const CAFE_PHOTO_DESCRIPTION = {
  title: '海边的一天',
  alt: '无人海岸：明亮天空、蓝绿色海面与岸边的白色浪花',
  text: '一张无人海岸的风景照片：明亮天空、蓝绿色海面、沿岸浪花。画面没有人物。',
} as const;

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
