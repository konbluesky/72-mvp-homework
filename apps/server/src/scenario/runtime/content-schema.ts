import { z } from 'zod';

// Keep content compilation independent of built workspace packages.
export const ScenarioContentIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^(?!(?:__proto__|prototype|constructor)$)[a-zA-Z0-9_-]+$/);

/** Authored, audience-only text; never part of the browser's public manifest. */
export const ScenarioThoughtsSchema = z
  .record(ScenarioContentIdSchema, z.string().trim().min(1).max(120))
  .refine((thoughts) => Object.keys(thoughts).length <= 64)
  .default({});

/** Private scene direction; ordinary dialogue is generated from actual presented history. */
export const ScenarioChaptersSchema = z
  .array(
    z
      .object({
        id: ScenarioContentIdSchema,
        title: z.string().trim().min(1).max(80),
        purpose: z.string().trim().min(1).max(300),
        topics: z.array(z.string().trim().min(1).max(160)).max(8),
        opportunities: z.array(z.string().trim().min(1).max(200)).max(8),
        constraints: z.array(z.string().trim().min(1).max(200)).max(8),
        tone: z.string().trim().min(1).max(200),
        pacing: z.string().trim().min(1).max(300),
      })
      .strict(),
  )
  .min(1)
  .max(32)
  .refine(
    (chapters) => new Set(chapters.map((chapter) => chapter.id)).size === chapters.length,
    'Chapter IDs must be unique.',
  );

/** Optional authored shortcuts; only the server resolves a current beat to an Ink knot. */
export const ScenarioProgressionSchema = z
  .array(
    z
      .object({
        beats: z.array(ScenarioContentIdSchema).min(1).max(8),
        knot: z
          .string()
          .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
          .max(80),
        label: z.string().trim().min(1).max(100),
        locations: z.array(ScenarioContentIdSchema).min(1).max(8).optional(),
      })
      .strict(),
  )
  .max(32)
  .refine((steps) => {
    const beats = steps.flatMap((step) => step.beats);
    return new Set(beats).size === beats.length;
  }, 'Each beat must have only one progression destination.')
  .default([]);

const environmentVariant = z.object({ value: ScenarioContentIdSchema }).strict();
const environment = z
  .object({
    default: ScenarioContentIdSchema,
    variants: z.array(environmentVariant).max(20),
  })
  .strict();

/** Browser-safe presentation metadata contains no story conditions. */
export const PublicPresentationSchema = z
  .object({
    clientModule: z.string().regex(/^[a-z0-9-]+$/),
    character: ScenarioContentIdSchema,
    title: z.string().min(1).max(100),
    subtitle: z.string().max(100),
    speaker: z.string().min(1).max(80),
    speakerDescription: z.string().max(200).optional(),
    defaultCharacter: ScenarioContentIdSchema,
    phaseLabels: z.record(ScenarioContentIdSchema, z.string().max(80)),
    environment,
    assetRoot: z.string().regex(/^\/assets\/[a-z0-9-]+\/$/),
    minimumBackgrounds: z.number().int().positive().max(100),
  })
  .strict();

/** Shared by compilation and server loading; conditions remain server-only. */
export const ScenarioPresentationSchema = PublicPresentationSchema.extend({
  environment: environment.extend({
    variants: z
      .array(environmentVariant.extend({ requires: z.array(ScenarioContentIdSchema) }))
      .max(20),
  }),
});

export function publicPresentation(presentation: z.infer<typeof ScenarioPresentationSchema>) {
  return PublicPresentationSchema.parse({
    ...presentation,
    environment: {
      default: presentation.environment.default,
      variants: presentation.environment.variants.map(({ value }) => ({ value })),
    },
  });
}

export const ScenarioResourceSchema = z
  .object({
    kind: z.literal('image'),
    asset: ScenarioContentIdSchema,
    url: z
      .string()
      .regex(/^\/assets\/[a-zA-Z0-9_/.\-]+$/)
      .refine((value) => !value.includes('..')),
  })
  .strict();
