import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicRoot = resolve(root, 'apps/web/public');
const local = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('..') &&
      !value.includes(':') &&
      !value.includes('\\'),
  );
const digest = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().positive(),
});
const catalogSchema = z.object({
  files: z.union([z.array(digest.extend({ path: local })), z.record(local, digest)]),
});
async function files(directory: string): Promise<string[]> {
  const groups = await Promise.all(
    (await readdir(directory, { withFileTypes: true })).map((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? files(path) : [path];
    }),
  );
  return groups.flat();
}
async function verifyDigest(path: string, expected: { sha256: string; bytes?: number }) {
  const bytes = await readFile(path);
  if (
    (expected.bytes !== undefined && bytes.length !== expected.bytes) ||
    createHash('sha256').update(bytes).digest('hex') !== expected.sha256
  )
    throw new Error(`Asset digest mismatch: ${relative(root, path)}`);
  return bytes;
}

/** Audits files and references only; never mounts a page, decodes audio or calls a provider. */
export async function verifyPublicAssets() {
  const inventory = await files(publicRoot);
  const recorded = new Set<string>();
  for (const path of inventory.filter((path) => basename(path) === 'SOURCES.json')) {
    const catalog = catalogSchema.parse(JSON.parse(await readFile(path, 'utf8')));
    const entries = Array.isArray(catalog.files)
      ? catalog.files.map(({ path, ...entry }) => [path, entry] as const)
      : Object.entries(catalog.files);
    for (const [name, expected] of entries) {
      const asset = resolve(dirname(path), name);
      if (!asset.startsWith(publicRoot + sep) || recorded.has(asset))
        throw new Error(`Invalid or duplicate asset record: ${relative(root, asset)}`);
      await verifyDigest(asset, expected);
      recorded.add(asset);
    }
  }
  for (const path of inventory) {
    if (!path.endsWith('.md') && basename(path) !== 'SOURCES.json' && !recorded.has(path))
      throw new Error(`Public runtime asset has no provenance: ${relative(root, path)}`);
  }
  let references = 0;
  const webRoot = resolve(root, 'apps/web');
  const pages = (await readdir(webRoot))
    .filter((name) => name.endsWith('.html'))
    .map((name) => resolve(webRoot, name));
  for (const path of [...(await files(resolve(webRoot, 'src'))), ...pages]) {
    if (
      !/\.(?:tsx?|vue|css|html|json)$/.test(path) ||
      /\.(?:test|spec)\./.test(path) ||
      path.includes(`${sep}engine${sep}`)
    )
      continue;
    const source = await readFile(path, 'utf8');
    for (const match of source.matchAll(/["'`](\/(?:assets\/[^"'`\s<>]+|favicon\.svg))["'`]/g)) {
      const url = match[1]!;
      if (url.includes('${')) continue;
      const asset = resolve(publicRoot, url.slice(1));
      if (!asset.startsWith(publicRoot + sep)) throw new Error(`Asset escaped public root: ${url}`);
      const info = await stat(asset);
      if (info.isFile() && !asset.endsWith('.md') && !recorded.has(asset))
        throw new Error(`Unrecorded asset reference: ${url}`);
      references++;
    }
  }
  process.stdout.write(
    `Public assets verified: ${recorded.size} source hashes; ${references} local references.\n`,
  );
}

const audioCatalogSchema = z.object({
  entries: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string().min(1),
        file: local,
        mimeType: z.literal('audio/wav'),
        durationMs: z.number().positive(),
        sampleRate: z.number().int().positive(),
        sha256: digest.shape.sha256,
      }),
    )
    .min(1),
});
const audioConfigSchema = z.object({
  mock: z.object({ audioRoot: local.optional() }).optional(),
  voices: z.record(z.string(), z.object({ text: z.string(), file: local.optional() })),
});
function waveMetadata(bytes: Buffer) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('Invalid offline WAV header');
  let sampleRate = 0,
    byteRate = 0,
    dataSize = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (offset + 8 + size > bytes.length) throw new Error('Truncated offline WAV');
    if (kind === 'fmt ') {
      if (size < 16 || bytes.readUInt16LE(offset + 8) !== 1)
        throw new Error('Offline WAV must be PCM');
      sampleRate = bytes.readUInt32LE(offset + 12);
      byteRate = bytes.readUInt32LE(offset + 16);
    } else if (kind === 'data') dataSize += size;
    offset += 8 + size + (size % 2);
  }
  if (!sampleRate || !byteRate || !dataSize) throw new Error('Incomplete offline WAV metadata');
  return { sampleRate, durationMs: (dataSize / byteRate) * 1000 };
}
export async function verifyOfflineAudio() {
  let count = 0;
  const scenarios = resolve(root, 'apps/server/src/scenario');
  for (const entry of await readdir(scenarios, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let text: string;
    try {
      text = await readFile(resolve(scenarios, entry.name, 'manifest.json'), 'utf8');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
      throw error;
    }
    const config = audioConfigSchema.parse(JSON.parse(text));
    if (!config.mock?.audioRoot) continue;
    const audioRoot = resolve(root, config.mock.audioRoot);
    const catalog = audioCatalogSchema.parse(
      JSON.parse(await readFile(resolve(audioRoot, 'manifest.json'), 'utf8')),
    );
    const entries = new Map(catalog.entries.map((item) => [item.id, item]));
    const names = new Set(catalog.entries.map((item) => item.file));
    if (entries.size !== catalog.entries.length || names.size !== catalog.entries.length)
      throw new Error(`Duplicate offline audio record: ${entry.name}`);
    for (const [id, voice] of Object.entries(config.voices)) {
      const record = entries.get(id);
      if (!record || record.file !== voice.file || record.text !== voice.text)
        throw new Error(`Offline voice catalog mismatch: ${entry.name}/${id}`);
    }
    for (const record of catalog.entries) {
      const bytes = await verifyDigest(resolve(audioRoot, record.file), record);
      const wave = waveMetadata(bytes);
      if (
        wave.sampleRate !== record.sampleRate ||
        Math.abs(wave.durationMs - record.durationMs) > 1
      )
        throw new Error(`Offline audio metadata mismatch: ${record.file}`);
      count++;
    }
    for (const path of await files(audioRoot))
      if (path.endsWith('.wav') && !names.has(relative(audioRoot, path).split(sep).join('/')))
        throw new Error(`Unrecorded offline WAV: ${relative(root, path)}`);
  }
  process.stdout.write(
    `Offline audio verified: ${count} WAV hashes, headers and authored voice bindings.\n`,
  );
}
