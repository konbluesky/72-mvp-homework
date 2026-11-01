import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Compiler, CompilerOptions, JsonFileHandler } from 'inkjs/full';
import { z } from 'zod';
import {
  ScenarioContentIdSchema as id,
  ScenarioPresentationSchema,
  ScenarioResourceSchema,
  ScenarioThoughtsSchema,
  publicPresentation,
} from '../apps/server/src/scenario/runtime/content-schema.js';

const scenarios = new URL('../apps/server/src/scenario/', import.meta.url);
const schema = z.object({
  id,
  version: z.string().min(1),
  inkVersion: z.string().min(1),
  entry: z.string().min(1),
  presentation: ScenarioPresentationSchema,
  locations: z.record(id, z.string().min(1)),
  ambiences: z.array(id),
  endings: z.array(id),
  resources: z.record(id, ScenarioResourceSchema),
  openingVoice: z.string().optional(),
  voices: z.record(id, z.unknown()),
  thoughts: ScenarioThoughtsSchema,
  playerReplies: z.record(id, z.string()).optional(),
  directorNotes: z.array(z.object({ replyActions: z.array(id).optional() })).optional(),
});
async function exists(url: URL) {
  try {
    await readFile(url);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}
async function inkFiles(root: URL, prefix = ''): Promise<string[]> {
  const entries = await readdir(new URL(prefix, root), { withFileTypes: true });
  const groups = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? inkFiles(root, `${prefix}${entry.name}/`)
        : Promise.resolve(entry.name.endsWith('.ink') ? [prefix + entry.name] : []),
    ),
  );
  return groups.flat().sort();
}
async function output(url: URL, body: string) {
  const current = (await exists(url)) ? await readFile(url, 'utf8') : null;
  if (process.argv.includes('--check')) {
    if (current !== body) throw new Error(`Stale scenario output: ${fileURLToPath(url)}`);
  } else if (current !== body) {
    await mkdir(new URL('.', url), { recursive: true });
    await writeFile(url, body);
  }
}
let packages = 0;
for (const entry of await readdir(scenarios, { withFileTypes: true })) {
  if (!entry.isDirectory() || !(await exists(new URL(`${entry.name}/manifest.json`, scenarios))))
    continue;
  const root = new URL(`${entry.name}/`, scenarios);
  const manifestText = await readFile(new URL('manifest.json', root), 'utf8');
  const manifest = schema.parse(JSON.parse(manifestText));
  const files = await inkFiles(root);
  const sources: Record<string, string> = {};
  const lore = z
    .array(z.object({ id: z.string().min(1).max(80), text: z.string() }))
    .parse(JSON.parse(await readFile(new URL('lore.json', root), 'utf8')));
  const allowed: Record<string, readonly string[]> = {
    location: Object.keys(manifest.locations),
    prop: lore.map((item) => item.id),
    ambience: manifest.ambiences,
    ending: manifest.endings,
    environment: [
      manifest.presentation.environment.default,
      ...manifest.presentation.environment.variants.map((item) => item.value),
    ],
    photo: Object.keys(manifest.resources),
  };
  for (const file of files) {
    const source = await readFile(new URL(file, root), 'utf8');
    sources[file] = source;
    if (/^\s*EXTERNAL\s/m.test(source))
      throw new Error(`External bindings are not allowed: ${file}`);
    for (const tag of source.matchAll(/#\s*([^\]#\r\n]+)/g)) {
      const value = tag[1]!.trim();
      if (
        !/^(action:[a-z0-9-]+|explicit|cue:(location|prop|ambience|ending|environment|photo|beat):[a-z0-9_-]+|voice:[a-zA-Z0-9_-]+|thought:[a-zA-Z0-9_-]+)$/.test(
          value,
        )
      )
        throw new Error(`Unsupported story tag: ${file}`);
      const [kind, type, target] = value.split(':');
      if (kind === 'cue' && type && allowed[type] && (!target || !allowed[type]!.includes(target)))
        throw new Error(`Undeclared ${type} cue in ${file}: ${target}`);
      if (kind === 'voice' && type && !Object.hasOwn(manifest.voices, type))
        throw new Error(`Undeclared voice: ${type}`);
      if (kind === 'thought' && type && !Object.hasOwn(manifest.thoughts, type))
        throw new Error(`Undeclared thought: ${type}`);
    }
  }
  if (!sources['main.ink']) throw new Error(`Missing main.ink in ${entry.name}`);
  const actionIds = new Set(
    Object.values(sources).flatMap((source) =>
      [...source.matchAll(/action:([a-z0-9-]+)/g)].map((match) => match[1]!),
    ),
  );
  for (const key of Object.keys(manifest.playerReplies ?? {}))
    if (!actionIds.has(key)) throw new Error(`Unknown player reply action: ${key}`);
  for (const note of manifest.directorNotes ?? [])
    for (const key of note.replyActions ?? [])
      if (!actionIds.has(key) || !manifest.playerReplies?.[key])
        throw new Error(`Invalid guided reply reference: ${key}`);
  if (manifest.openingVoice && !manifest.voices[manifest.openingVoice])
    throw new Error('Undeclared opening voice');
  const diagnostics: string[] = [];
  const compiler = new Compiler(
    sources['main.ink'],
    new CompilerOptions(
      'main.ink',
      [],
      false,
      (message: string) => diagnostics.push(message),
      new JsonFileHandler(sources),
    ),
  );
  let story;
  try {
    story = compiler.Compile();
  } catch {
    throw new Error([...diagnostics, ...compiler.errors].join('\n') || 'Ink compilation failed');
  }
  if (compiler.errors.length) throw new Error(compiler.errors.join('\n'));
  const content = [
    manifestText,
    await readFile(new URL('character.json', root), 'utf8'),
    await readFile(new URL('lore.json', root), 'utf8'),
    ...Object.entries(sources).flat(),
  ];
  const hash = createHash('sha256').update(content.join('\n')).digest('hex');
  await output(
    new URL('compiled.json', root),
    JSON.stringify({
      storyId: manifest.id,
      version: manifest.version,
      inkVersion: manifest.inkVersion,
      hash,
      bytecode: JSON.parse(story.ToJson()),
    }) + '\n',
  );
  // Export only the validated public presentation subset, never bytecode, Lore, voices or private flags.
  const publicBody =
    JSON.stringify(
      {
        ...publicPresentation(manifest.presentation),
        id: manifest.id,
        version: manifest.version,
        locations: manifest.locations,
        resources: manifest.resources,
      },
      null,
      2,
    ) + '\n';
  await output(
    new URL(
      `../apps/web/src/webgal/scenes/${manifest.presentation.clientModule}/manifest.generated.json`,
      import.meta.url,
    ),
    publicBody,
  );
  process.stdout.write(
    `Ink ${manifest.id}: ${files.length} files; ${diagnostics.length} diagnostics\n`,
  );
  packages++;
}
if (!packages) throw new Error('No registered scenario content packages found.');
