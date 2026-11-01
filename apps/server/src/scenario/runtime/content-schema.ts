import { z } from 'zod';

// Keep content compilation independent of built workspace packages.
export const ScenarioContentIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^(?!(?:__proto__|prototype|constructor)$)[a-zA-Z0-9_-]+$/);

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
