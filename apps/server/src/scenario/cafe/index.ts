import { z } from 'zod';
import { ActionSchema, EmotionSchema, LocationSchema } from '@mira/protocol';
import artifact from './compiled.json' with { type: 'json' };
import manifestData from './manifest.json' with { type: 'json' };
import characterData from './character.json' with { type: 'json' };
import loreData from './lore.json' with { type: 'json' };
import type { ScenarioDefinition } from '../ports.js';
import { createMockProviders } from './mock.js';
import { InkScenario } from '../runtime/ink.js';
import { scenarioContext, validateReply } from '../runtime/context.js';

const flag = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z_]+$/);
const manifest = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    inkVersion: z.literal('2.4.0'),
    entry: z.literal('menu'),
    performanceActions: z.array(ActionSchema).min(1).max(32),
    mock: z
      .object({
        audioRoot: z.string().regex(/^assets\/[a-zA-Z0-9_/-]+$/),
        transcript: z.string().min(1).max(1000),
      })
      .strict(),
    presentation: z
      .object({
        clientModule: z.string().regex(/^[a-z0-9-]+$/),
        character: z.string().min(1).max(80),
        title: z.string().min(1).max(100),
        subtitle: z.string().max(100),
        speaker: z.string().min(1).max(80),
        speakerDescription: z.string().max(200).optional(),
        defaultCharacter: z.string().min(1).max(80),
        phaseLabels: z.record(z.string(), z.string().max(80)),
        environment: z
          .object({
            default: z.string().min(1).max(80),
            variants: z
              .array(
                z.object({ requires: z.array(flag), value: z.string().min(1).max(80) }).strict(),
              )
              .max(20),
          })
          .strict(),
        assetRoot: z.string().regex(/^\/assets\/[a-z0-9-]+\/$/),
        minimumBackgrounds: z.number().int().positive().max(100),
      })
      .strict(),
    recommendations: z
      .object({
        decisionPhases: z.array(z.string().max(80)).max(20),
        maxGuiding: z.number().int().min(0).max(3),
      })
      .strict(),
    ambiences: z.array(z.string().min(1).max(80)).min(1).max(32),
    endings: z.array(z.string().min(1).max(80)).max(32),
    resources: z.record(
      z.string(),
      z
        .object({
          kind: z.literal('image'),
          asset: z.string().min(1).max(80),
          url: z
            .string()
            .regex(/^\/assets\/[a-zA-Z0-9_/.\-]+$/)
            .refine((value) => !value.includes('..')),
        })
        .strict(),
    ),
    openingVoice: z.string().min(1).max(80),
    playerReplies: z.record(z.string().regex(/^[a-z0-9-]+$/), z.string().trim().min(1).max(120)),
    actionDescriptions: z.record(z.string(), z.string().max(300)),
    entries: z
      .object({ story: z.literal('story_start'), conversation: z.literal('conversation_start') })
      .strict(),
    phases: z.tuple([
      z.literal('arrival'),
      z.literal('exploration'),
      z.literal('decision'),
      z.literal('epilogue'),
    ]),
    locations: z.record(LocationSchema, z.string().min(1).max(100)),
    voices: z.record(
      z.string(),
      z
        .object({
          text: z.string().min(1).max(160),
          file: z.string().regex(/^[a-zA-Z0-9_-]+\.wav$/),
          emotion: EmotionSchema,
          action: ActionSchema,
        })
        .strict(),
    ),
    projection: z
      .object({
        flags: z.array(flag).max(20),
        revealed: z.record(z.string(), flag),
        facts: z.record(z.string().min(1).max(80), flag),
      })
      .strict(),
    directorNotes: z
      .array(
        z
          .object({
            requires: z.array(flag).optional(),
            locations: z.array(LocationSchema).optional(),
            text: z.string().max(500),
            replyActions: z
              .array(z.string().regex(/^[a-z0-9-]+$/))
              .max(3)
              .optional(),
            chatReplies: z.array(z.string().trim().min(1).max(120)).max(3).optional(),
          })
          .strict(),
      )
      .max(10),
  })
  .strict()
  .parse(manifestData);
const character = z
  .object({
    name: z.string().min(1),
    age: z.number().int().min(18),
    identity: z.string().max(800),
    style: z.string().max(800),
    boundaries: z.array(z.string().max(300)).max(10),
  })
  .strict()
  .parse(characterData);
const lore = z
  .array(
    z
      .object({
        id: z.string().min(1).max(80),
        title: z.string().max(120).optional(),
        text: z.string().max(4000),
        requires: z.array(flag),
        locations: z.array(LocationSchema).optional(),
      })
      .strict(),
  )
  .max(50)
  .parse(loreData);
if (
  artifact.storyId !== manifest.id ||
  artifact.version !== manifest.version ||
  artifact.inkVersion !== manifest.inkVersion
)
  throw new Error('Scenario artifact version mismatch. Run npm run scenarios:build.');
const references = [
  ...lore.flatMap((entry) => entry.requires),
  ...manifest.directorNotes.flatMap((note) => note.requires ?? []),
  ...Object.values(manifest.projection.revealed),
  ...Object.values(manifest.projection.facts),
];
if (references.some((name) => !manifest.projection.flags.includes(name)))
  throw new Error('Scenario references an undeclared fact.');
const runtime = new InkScenario({
  id: manifest.id,
  version: manifest.version,
  entry: manifest.entry,
  entries: manifest.entries,
  hash: artifact.hash,
  bytecode: artifact.bytecode,
  phases: manifest.phases,
  locations: Object.keys(manifest.locations),
  ambiences: manifest.ambiences,
  endings: manifest.endings,
  resourceIds: Object.keys(manifest.resources),
  presentation: manifest.presentation,
  recommendations: manifest.recommendations,
  projection: manifest.projection,
  directorNotes: manifest.directorNotes,
  voices: manifest.voices,
  actionDescriptions: manifest.actionDescriptions,
  playerReplies: manifest.playerReplies,
  documents: lore,
});
export const cafeScenario: ScenarioDefinition = {
  mockProviders: createMockProviders,
  initial: (entry) => runtime.initial(entry),
  frame: (checkpoint) => runtime.frame(checkpoint),
  suggestions: (checkpoint) => runtime.suggestions(checkpoint),
  opening: (checkpoint) => {
    const line = manifest.voices[manifest.openingVoice];
    if (!line) throw new Error('Scenario opening voice is not declared.');
    return {
      text: line.text,
      revision: checkpoint.revision,
      suggestions: runtime.suggestions(checkpoint),
    };
  },
  propose: (input, checkpoint) => runtime.propose(input, checkpoint),
  accept: (current, next) => runtime.accept(current, next),
  context: (checkpoint, history) => {
    const context = scenarioContext(
      character,
      runtime.frame(checkpoint),
      history,
      manifest.recommendations,
    );
    return {
      ...context,
      scene: {
        ...context.scene,
        performanceActions: manifest.performanceActions,
        replyCandidates: runtime.suggestions(checkpoint),
        openingLine:
          checkpoint.revision === 0 ? manifest.voices[manifest.openingVoice]?.text : null,
      },
    };
  },
  validate: (plan) => validateReply(plan, manifest.performanceActions),
};
