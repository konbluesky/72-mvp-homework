import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const json = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const provenance = json('apps/web/third-party/webgal/SOURCES.json');
const patches = json('apps/web/third-party/webgal/PATCHES.json');
const lock = json('package-lock.json');
const hash = (path) =>
  createHash('sha256')
    .update(readFileSync(join(root, path)))
    .digest('hex');
const errors = [];

function files(directory) {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

for (const [path, original] of Object.entries(provenance.files)) {
  const patch = patches.files[path];
  if (patch && !patch.reason) errors.push(`Missing patch reason: ${path}`);
  if (patch?.omitted) {
    if (existsSync(join(root, path))) errors.push(`Omitted upstream asset restored: ${path}`);
    continue;
  }
  try {
    if (hash(path) !== (patch?.sha256 ?? original.sha256)) errors.push(`Source drift: ${path}`);
  } catch {
    errors.push(`Missing imported source: ${path}`);
  }
}
for (const [path, patch] of Object.entries(patches.files)) {
  if (patch.omitted || provenance.files[path]) continue;
  if (!patch.reason || hash(path) !== patch.sha256)
    errors.push(`Unrecorded local extension: ${path}`);
}
for (const path of [
  ...files('apps/web/src/engine/webgal'),
  ...files('packages/webgal-parser/src'),
]) {
  if (!provenance.files[path] && !patches.files[path]) errors.push(`Untracked fork file: ${path}`);
}

// A single renderer/framework version must satisfy the engine and the existing SDK peers.
for (const [name, expected] of Object.entries({
  react: '18.3.1',
  'react-dom': '18.3.1',
  'pixi.js': '6.5.10',
  '@pixi/core': '6.5.10',
  'pixi-live2d-display-webgal': '0.5.19',
})) {
  const entries = Object.entries(lock.packages).filter(([key]) =>
    key.endsWith(`node_modules/${name}`),
  );
  if (entries.length !== 1 || entries[0][1].version !== expected)
    errors.push(`Expected one ${name}@${expected} in the root lockfile`);
}

for (const path of files('apps/web/src/webgal/runtime')) {
  if (!/\.tsx?$/.test(path) || path.endsWith('.test.ts')) continue;
  const source = readFileSync(join(root, path), 'utf8');
  if (/from\s+['"][^'"]*(?:scenes\/|characters\/|stores\/scene|scene\/live2d)/.test(source))
    errors.push(`Runtime imports a concrete scene/character: ${relative(root, join(root, path))}`);
}

if (errors.length) {
  process.stderr.write(`${errors.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `WebGAL ${provenance.engineVersion} / ${provenance.commit}: ${Object.keys(provenance.files).length} source records, ${Object.keys(patches.files).length} declared patches; dependency and import boundaries valid.\n`,
  );
}
