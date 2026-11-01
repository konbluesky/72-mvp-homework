import { mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import SwaggerParser from '@apidevtools/swagger-parser';
import {
  ServerEventSchema,
  ReplyPlanSchema,
  AudioInputMetadataSchema,
  ConnectionEventSchema,
  ConnectionProbeSchema,
} from '@mira/protocol';
import { createApp } from '../apps/server/src/app.js';
import { loadConfig } from '../apps/server/src/config/index.js';

const directory = await mkdtemp(join(tmpdir(), 'mira-contract-'));
const app = await createApp({
  config: loadConfig({ APP_MODE: 'mock', NODE_ENV: 'test', MEDIA_LOCAL_DIR: directory }),
  logger: false,
});
try {
  const document = app.swagger();
  if (!('openapi' in document)) throw new Error('Expected OpenAPI 3 document');
  document.components ??= {};
  document.components.schemas ??= {};
  // JSON Schema comes from the same validators used by the stream and Graph.
  Object.assign(document.components.schemas, {
    ServerEvent: z.toJSONSchema(ServerEventSchema),
    ConnectionEvent: z.toJSONSchema(ConnectionEventSchema),
    ConnectionProbe: z.toJSONSchema(ConnectionProbeSchema),
    ReplyPlan: z.toJSONSchema(ReplyPlanSchema),
    AudioInputMetadata: z.toJSONSchema(AudioInputMetadataSchema),
  });
  const body = JSON.stringify(document, null, 2) + '\n';
  await SwaggerParser.validate(JSON.parse(body));
  const path = 'docs/contracts/openapi.json';
  if (process.argv.includes('--check')) {
    if ((await readFile(path, 'utf8')) !== body)
      throw new Error('OpenAPI is stale; run npm run contracts:generate');
    process.stdout.write('OpenAPI matches route metadata and protocol schemas.\n');
  } else {
    await mkdir('docs/contracts', { recursive: true });
    await writeFile(path, body);
    process.stdout.write(`${path}\n`);
  }
} finally {
  await app.close();
  await rm(directory, { recursive: true, force: true });
}
