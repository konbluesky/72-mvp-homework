import type { ImageRecipe } from './types.js';

function tags(parts: Array<string | undefined>): string {
  return [
    ...new Set(
      parts
        .flatMap((part) => (part ?? '').split(','))
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ].join(', ');
}

/** Authored appearance stays fixed; dialogue intent selects only scene-authored tag fragments. */
export function imagePrompts(recipe: ImageRecipe): { positive: string; negative: string } {
  return {
    positive: tags([
      recipe.positive,
      recipe.character,
      recipe.appearance,
      recipe.environment,
      recipe.intentTags?.focus[recipe.intent.focus],
      recipe.intentTags?.mood[recipe.intent.mood],
      recipe.intentTags?.framing[recipe.intent.framing],
    ]),
    negative: tags([recipe.negative]),
  };
}
