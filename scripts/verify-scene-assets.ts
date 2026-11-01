import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
const local = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('..') &&
      !value.includes(':') &&
      !value.includes('\\'),
  );
const metadataSchema = z.object({
  id: z.string(),
  assetRoot: z.string().regex(/^\/assets\/[a-z0-9-]+\/$/),
  minimumBackgrounds: z.number().int().positive(),
  resources: z.record(
    z.string(),
    z.object({
      url: z
        .string()
        .regex(/^\/assets\/[a-zA-Z0-9_/.-]+$/)
        .refine((value) => !value.includes('..')),
    }),
  ),
});
const sourcesSchema = z.object({
  baseBackgrounds: z
    .array(z.string().regex(/^[a-zA-Z0-9_-]+$/))
    .min(1)
    .max(100),
  files: z.record(
    local,
    z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive() }),
  ),
});
/** Content-package verification only; Cubism ownership and provenance are checked separately. */
export async function verifySceneAssets() {
  const modules = new URL('../apps/web/src/webgal/scenes/', import.meta.url);
  let count = 0;
  for (const entry of await readdir(modules, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let text: string;
    try {
      text = await readFile(new URL(`${entry.name}/manifest.generated.json`, modules), 'utf8');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
      throw error;
    }
    const metadata = metadataSchema.parse(JSON.parse(text));
    const root = resolve('apps/web/public', metadata.assetRoot.slice(1));
    const sources = sourcesSchema.parse(
      JSON.parse(await readFile(resolve(root, 'SOURCES.json'), 'utf8')),
    );
    if (
      sources.baseBackgrounds.length < metadata.minimumBackgrounds ||
      new Set(sources.baseBackgrounds).size !== sources.baseBackgrounds.length
    )
      throw new Error(`Invalid backgrounds: ${metadata.id}`);
    for (const id of sources.baseBackgrounds)
      if (!Object.keys(sources.files).some((file) => file.startsWith(`${id}.`)))
        throw new Error(`Missing scene background: ${id}`);
    for (const [file, expected] of Object.entries(sources.files)) {
      const bytes = await readFile(resolve(root, file));
      if (
        bytes.length !== expected.bytes ||
        createHash('sha256').update(bytes).digest('hex') !== expected.sha256
      )
        throw new Error(`Scene asset mismatch: ${file}`);
    }
    for (const resource of Object.values(metadata.resources))
      await stat(resolve('apps/web/public', resource.url.slice(1)));
    process.stdout.write(
      `Scene assets ${metadata.id}: ${sources.baseBackgrounds.length} backgrounds; ${Object.keys(sources.files).length} verified files\n`,
    );
    count++;
  }
  if (!count) throw new Error('No public scene asset manifests found. Run scenarios:build.');
}
