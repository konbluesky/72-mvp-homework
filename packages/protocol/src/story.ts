import { z } from 'zod';

/** Content identifiers are bounded here; the selected module validates membership. */
export const ContentIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^(?!(?:__proto__|prototype|constructor)$)[a-zA-Z0-9_-]+$/);
export const LocationSchema = ContentIdSchema;
export type StoryLocation = z.infer<typeof LocationSchema>;
export const StoryPropSchema = ContentIdSchema;
export type StoryProp = z.infer<typeof StoryPropSchema>;
export const EndingSchema = ContentIdSchema;
export type StoryEnding = z.infer<typeof EndingSchema>;
export const StoryActionSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9-]+$/),
    label: z.string().min(1).max(100),
    kind: z.enum(['move', 'inspect', 'talk', 'choose', 'view']),
    explicit: z.boolean(),
    description: z.string().max(300).default(''),
  })
  .strict();
export type StoryAction = z.infer<typeof StoryActionSchema>;
export const StoryStateSchema = z
  .object({
    location: LocationSchema,
    revealed: z.array(StoryPropSchema).max(64),
    ambience: ContentIdSchema,
    ending: EndingSchema.nullable(),
    phase: ContentIdSchema.default('loading'),
    revision: z.number().int().nonnegative().default(0),
    actions: z.array(StoryActionSchema).max(24).default([]),
    milestones: z.array(z.string().max(80)).max(20).default([]),
  })
  .strict();
export type StoryState = z.infer<typeof StoryStateSchema>;
export const initialStory = (
  view: Partial<Pick<StoryState, 'location' | 'ambience' | 'phase'>> = {},
): StoryState => ({
  location: 'loading',
  revealed: [],
  ambience: 'default',
  ending: null,
  phase: 'loading',
  revision: 0,
  actions: [],
  milestones: [],
  ...view,
});
export const StoryInteractionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('move'), location: LocationSchema }).strict(),
  z.object({ kind: z.literal('inspect'), prop: StoryPropSchema }).strict(),
  z.object({ kind: z.literal('choose'), ending: EndingSchema }).strict(),
  z
    .object({
      kind: z.literal('action'),
      actionId: StoryActionSchema.shape.id,
      revision: z.number().int().nonnegative(),
    })
    .strict(),
]);
export type StoryInteraction = z.infer<typeof StoryInteractionSchema>;
export const LocationEventSchema = z
  .object({ type: z.literal('location'), location: LocationSchema })
  .strict();
export const PropEventSchema = z
  .object({
    type: z.literal('prop'),
    prop: StoryPropSchema,
    document: z
      .object({ title: z.string().max(120), text: z.string().max(4000) })
      .strict()
      .optional(),
  })
  .strict();
export const AmbienceEventSchema = z
  .object({ type: z.literal('ambience'), ambience: ContentIdSchema })
  .strict();
export const EndingEventSchema = z
  .object({ type: z.literal('ending'), ending: EndingSchema })
  .strict();
export const BeatEventSchema = z
  .object({ type: z.literal('beat'), beatId: z.string().min(1).max(80) })
  .strict();
export const StoryCueSchema = z.discriminatedUnion('type', [
  LocationEventSchema,
  PropEventSchema,
  AmbienceEventSchema,
  EndingEventSchema,
  BeatEventSchema,
]);
export type StoryCue = z.infer<typeof StoryCueSchema>;

/** Pure, bounded projection; transport validates ownership and issued dependencies first. */
export function projectStory(state: StoryState, event: StoryCue): StoryState {
  switch (event.type) {
    case 'location':
      return { ...state, location: event.location };
    case 'prop':
      return { ...state, revealed: [...new Set([...state.revealed, event.prop])] };
    case 'ambience':
      return { ...state, ambience: event.ambience };
    case 'ending':
      return { ...state, ending: event.ending };
    case 'beat':
      return state;
  }
}
