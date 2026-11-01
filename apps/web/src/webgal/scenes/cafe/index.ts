import { initialStory } from '@mira/protocol';
import type { SceneModule } from '../module.js';
import { CafePresentation } from './presentation.js';
import { CAFE_ASSETS, cafeLocation } from './definition.js';
import metadata from './manifest.generated.json';
import { isCharacterId, type CharacterId } from '../../characters/profiles/index.js';
const defaultCharacter = metadata.defaultCharacter;
function characterId(id: string): CharacterId {
  if (isCharacterId(id)) return id;
  throw new Error('CAFE_CHARACTER_NOT_REGISTERED');
}
export const cafeSceneModule: SceneModule = {
  id: metadata.id,
  version: metadata.version,
  title: metadata.title,
  subtitle: metadata.subtitle,
  speaker: metadata.speaker,
  speakerDescription: metadata.speakerDescription,
  phaseLabels: metadata.phaseLabels,
  characters: [characterId('miara'), characterId('haru')],
  defaultCharacter: characterId(defaultCharacter),
  characterPresentation: {
    hiddenParts: {
      miara: [
        'PartBackgroundAll',
        'PartBackground',
        'PartWaterSurface',
        'PartSparkle',
        'PartFairy',
      ],
    },
  },
  assets: CAFE_ASSETS,
  initialView: {
    story: initialStory({ location: 'lobby', ambience: 'open', phase: 'exploration' }),
    environment: metadata.environment.default,
  },
  location: cafeLocation,
  createPresentation: (lease, actor, state) => new CafePresentation(lease, actor, state),
  environmentPreviews: metadata.environment.variants.map((variant) => ({
    label: '环境预览',
    value: variant.value,
  })),
};
