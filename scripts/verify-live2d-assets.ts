import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { z } from 'zod';

const root = resolve('apps/web/public/assets/live2d');
const localPath = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('..') &&
      !value.includes(':') &&
      !value.includes('\\'),
    'Asset paths must remain local',
  );
const sourcesSchema = z.object({
  files: z
    .array(
      z.object({
        path: localPath,
        source: z.string(),
        bytes: z.number().int().positive(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .min(10),
});
const manifestSchema = z
  .object({
    Version: z.literal(3),
    FileReferences: z
      .object({
        Moc: localPath,
        Textures: z.array(localPath).min(1).max(4),
        Physics: localPath,
        Pose: localPath,
        DisplayInfo: localPath,
        UserData: localPath,
      })
      .strict(),
    Groups: z.array(
      z.object({ Target: z.literal('Parameter'), Name: z.string(), Ids: z.array(z.string()) }),
    ),
    HitAreas: z.array(z.object({ Id: z.string(), Name: z.string() })),
  })
  .strict();
function path(relative: string): string {
  const result = resolve(root, relative);
  if (!result.startsWith(root + sep)) throw new Error('Asset path escaped root');
  return result;
}
const provenance = sourcesSchema.parse(
  JSON.parse(await readFile(path('SOURCES.json'), 'utf8')) as unknown,
);
const paths = new Set<string>();
for (const entry of provenance.files) {
  if (paths.has(entry.path)) throw new Error(`Duplicate provenance: ${entry.path}`);
  paths.add(entry.path);
  const bytes = await readFile(path(entry.path));
  if (
    bytes.length !== entry.bytes ||
    createHash('sha256').update(bytes).digest('hex') !== entry.sha256
  )
    throw new Error(`Asset hash mismatch: ${entry.path}`);
}
const model = manifestSchema.parse(
  JSON.parse(await readFile(path('haru/Haru.model3.json'), 'utf8')) as unknown,
);
for (const reference of [
  model.FileReferences.Moc,
  ...model.FileReferences.Textures,
  model.FileReferences.Physics,
  model.FileReferences.Pose,
  model.FileReferences.DisplayInfo,
  model.FileReferences.UserData,
]) {
  const relative = `haru/${reference}`;
  if (!paths.has(relative) || !(await stat(path(relative))).isFile())
    throw new Error(`Missing referenced asset: ${reference}`);
}
const moc = await readFile(path(`haru/${model.FileReferences.Moc}`));
if (moc.subarray(0, 4).toString('ascii') !== 'MOC3') throw new Error('Invalid Cubism model binary');
for (const texture of model.FileReferences.Textures) {
  const bytes = await readFile(path(`haru/${texture}`));
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
    throw new Error('Invalid PNG texture');
}
const motionEntry = z.object({ File: localPath }).strict();
const originalMotionGroup = z.array(motionEntry).length(1);
const miaraSchema = manifestSchema.extend({
  FileReferences: manifestSchema.shape.FileReferences.omit({ Pose: true, UserData: true })
    .extend({
      Motions: z
        .object({ Idle: originalMotionGroup, Tap: originalMotionGroup, Flic: originalMotionGroup })
        .strict(),
    })
    .strict(),
});
const miara = miaraSchema.parse(
  JSON.parse(await readFile(path('miara/miara_pro_t03.model3.json'), 'utf8')) as unknown,
);
const miaraMotions = Object.values(miara.FileReferences.Motions).flat();
for (const reference of [
  miara.FileReferences.Moc,
  ...miara.FileReferences.Textures,
  miara.FileReferences.Physics,
  miara.FileReferences.DisplayInfo,
  ...miaraMotions.map((motion) => motion.File),
]) {
  const relative = `miara/${reference}`;
  if (!paths.has(relative) || !(await stat(path(relative))).isFile())
    throw new Error(`Missing Miara asset or provenance: ${reference}`);
}
const miaraMoc = await readFile(path(`miara/${miara.FileReferences.Moc}`));
if (miaraMoc.subarray(0, 4).toString('ascii') !== 'MOC3')
  throw new Error('Invalid Miara Cubism model binary');
for (const texture of miara.FileReferences.Textures) {
  const bytes = await readFile(path(`miara/${texture}`));
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
    throw new Error('Invalid Miara PNG texture');
}
const motionSchema = z.object({
  Version: z.literal(3),
  Meta: z.object({ Duration: z.number().finite().positive(), Loop: z.boolean() }),
  Curves: z.array(z.unknown()).min(1),
});
for (const motion of miaraMotions) {
  motionSchema.parse(JSON.parse(await readFile(path(`miara/${motion.File}`), 'utf8')) as unknown);
}
for (const required of [
  'vendor/pixi.min.js',
  'vendor/cubism4.min.js',
  'vendor/live2dcubismcore.min.js',
  'vendor/licenses/pixi-MIT.txt',
  'vendor/licenses/pixi-live2d-display-MIT.txt',
  'vendor/licenses/Live2D-Proprietary.html',
  'vendor/licenses/Live2D-Sample-Terms.html',
  'cafe-background.jpg',
  'haru-poster.png',
])
  if (!paths.has(required)) throw new Error(`Missing runtime provenance: ${required}`);
await stat(path('NOTICE.md'));
process.stdout.write(
  `Live2D assets verified: ${paths.size} SHA-256 records; Haru + Miara local references; ${miaraMotions.length} Miara motions; no sample audio.\n`,
);

// Scene packages own their own catalogs and minimum background requirements.
await (await import('./verify-scene-assets.js')).verifySceneAssets();
const projectAssets = await import('./verify-project-assets.js');
await projectAssets.verifyPublicAssets();
await projectAssets.verifyOfflineAudio();
