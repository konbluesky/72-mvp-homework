import { describe, expect, it } from 'vitest';
import authored from '../scenario/cafe/image-sharing.json' with { type: 'json' };
import { imagePrompts } from './prompt.js';
import type { ImageRecipe } from './types.js';

const recipe: ImageRecipe = {
  ...authored,
  seed: 1,
  intent: { focus: 'character', mood: 'warm', framing: 'portrait' },
};

describe('scene-authored Pony image prompts', () => {
  it('uses the supplied character appearance and Pony quality tags without the former prose', () => {
    const prompt = imagePrompts(recipe);
    expect(prompt.positive.startsWith('score_9, score_8_up, score_7_up')).toBe(true);
    for (const tag of [
      'side_ponytail',
      'blue_eyes',
      'grey_jacket',
      'white_trim',
      'blue_ascot',
      'striped_ascot',
    ])
      expect(prompt.positive).toContain(tag);
    expect(prompt.positive).not.toContain('long dark hair');
    expect(prompt.positive).not.toMatch(/[\u4e00-\u9fff]/u);
    expect(prompt.negative).toContain('long_hair');
    expect(prompt.negative).toContain('navy_blue_jacket');
  });

  it('maps finite dialogue intent to actual authored visual tags while keeping identity stable', () => {
    const warm = imagePrompts(recipe).positive;
    const quiet = imagePrompts({
      ...recipe,
      intent: { focus: 'prop', mood: 'quiet', framing: 'detail' },
    }).positive;
    expect(warm).toContain('gentle_smile');
    expect(quiet).toContain('holding_cup');
    expect(quiet).toContain('calm_expression');
    expect(quiet).toContain('close-up');
    expect(quiet).not.toContain('gentle_smile');
    for (const prompt of [warm, quiet]) {
      expect(prompt).toContain(recipe.appearance);
      const tags = prompt.split(', ');
      expect(tags).not.toContain('prop');
      expect(tags).not.toContain('quiet');
      expect(tags).not.toContain('detail');
      expect(new Set(tags).size).toBe(tags.length);
    }
  });
});
