import { readFile, readdir } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { PLATFORM_NAME } from '../apps/web/src/app/platform.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const errors: string[] = [];
const composition = new Set([
  'apps/server/src/scenario/index.ts',
  'apps/web/src/app/main.ts',
  'apps/web/src/webgal/main.tsx',
  'apps/web/src/webgal/composition.ts',
]);
const authoredPackage = (path: string) =>
  path.match(/^apps\/server\/src\/scenario\/(?!runtime\/)([^/]+)\//)?.[0] ??
  path.match(/^apps\/web\/src\/webgal\/scenes\/([^/]+)\//)?.[0];

async function files(directory: string): Promise<string[]> {
  const groups = await Promise.all(
    (await readdir(resolve(root, directory), { withFileTypes: true })).map((entry) => {
      const path = `${directory}/${entry.name}`;
      return entry.isDirectory() ? files(path) : [path];
    }),
  );
  return groups.flat();
}

// Derive content markers from authored packages instead of hardcoding the default story here.
const markers = new Set<string>();
for (const entry of await readdir(resolve(root, 'apps/server/src/scenario'), {
  withFileTypes: true,
})) {
  if (!entry.isDirectory() || entry.name === 'runtime') continue;
  let text: string;
  try {
    text = await readFile(
      resolve(root, `apps/server/src/scenario/${entry.name}/manifest.json`),
      'utf8',
    );
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
    throw error;
  }
  const manifest = JSON.parse(text);
  for (const value of [
    manifest.id,
    manifest.presentation.title,
    manifest.presentation.subtitle,
    manifest.presentation.speaker,
    manifest.presentation.character,
    manifest.presentation.assetRoot,
    ...Object.keys(manifest.resources),
    ...Object.keys(manifest.projection.facts),
  ])
    if (typeof value === 'string' && value.length >= 3) markers.add(value);
}

let checked = 0;
for (const directory of ['apps/server/src', 'apps/web/src', 'packages/protocol/src']) {
  for (const path of await files(directory)) {
    if (
      !/\.(?:[cm]?tsx?|vue|css)$/.test(path) ||
      /\.(?:test|spec)\./.test(path) ||
      path.startsWith('apps/web/src/engine/')
    )
      continue;
    const source = await readFile(resolve(root, path), 'utf8');
    const script = path.endsWith('.vue')
      ? [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
          .map((match) => match[1])
          .join('\n')
      : source;
    for (const imported of ts.preProcessFile(script, true, true).importedFiles) {
      if (!imported.fileName.startsWith('.')) continue;
      const target = relative(root, resolve(root, dirname(path), imported.fileName))
        .split(sep)
        .join('/');
      if (
        (path.startsWith('apps/web/') && target.startsWith('apps/server/')) ||
        (path.startsWith('apps/server/') && target.startsWith('apps/web/')) ||
        (path.startsWith('packages/protocol/') && target.startsWith('apps/'))
      )
        errors.push(`${path}: cross-application import ${imported.fileName}`);
      const owner = authoredPackage(target);
      if (owner && owner !== authoredPackage(path) && !composition.has(path))
        errors.push(`${path}: concrete scene import ${imported.fileName}`);
    }
    if (!authoredPackage(path)) {
      // Historical npm scope names identify packages, not authored character identities.
      const content = source.replace(/(['"])@[a-z0-9-]+\/[a-z0-9-]+\1/g, '').toLowerCase();
      for (const marker of markers)
        if (content.includes(marker.toLowerCase()))
          errors.push(`${path}: authored content marker ${marker}`);
    }
    checked++;
  }
}

for (const page of ['index.html', 'legacy.html', 'webgal.html']) {
  const html = await readFile(resolve(root, 'apps/web', page), 'utf8');
  if (!html.includes(`<title>${PLATFORM_NAME}`)) errors.push(`${page}: platform title mismatch`);
}
if (errors.length) throw new Error(errors.join('\n'));
process.stdout.write(`Module boundaries verified: ${checked} production source files.\n`);
