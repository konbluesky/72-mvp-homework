import { describe, expect, it } from 'vitest';
import {
  PublicPresentationSchema,
  ScenarioPresentationSchema,
  publicPresentation,
} from './content-schema.js';

const presentation = {
  clientModule: 'other-story',
  character: 'guide',
  title: 'A different story',
  subtitle: '',
  speaker: 'Guide',
  defaultCharacter: 'haru',
  phaseLabels: { arrival: 'Arrival' },
  environment: {
    default: 'daylight',
    variants: [{ value: 'sunset', requires: ['private_clue_seen'] }],
  },
  assetRoot: '/assets/other-story/',
  minimumBackgrounds: 1,
};

describe('public scenario presentation boundary', () => {
  it('exports rendering presets without the private conditions that unlock them', () => {
    const authored = ScenarioPresentationSchema.parse(presentation);
    const published = publicPresentation(authored);
    expect(published.environment).toEqual({
      default: 'daylight',
      variants: [{ value: 'sunset' }],
    });
    expect(JSON.stringify(published)).not.toContain('private_clue_seen');
    expect(authored.environment.variants[0]!.requires).toEqual(['private_clue_seen']);
    expect(PublicPresentationSchema.safeParse(authored).success).toBe(false);
  });

  it('rejects undeclared payloads and reserved identifiers at the shared content boundary', () => {
    expect(
      ScenarioPresentationSchema.safeParse({ ...presentation, lore: 'Hidden contents' }).success,
    ).toBe(false);
    expect(
      ScenarioPresentationSchema.safeParse({ ...presentation, defaultCharacter: 'constructor' })
        .success,
    ).toBe(false);
  });
});
