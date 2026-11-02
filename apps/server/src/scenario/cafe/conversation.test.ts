import { expect, it } from 'vitest';
import { cafeScenario } from './index.js';

it('keeps the original conversation at its seat without requiring WebGAL navigation', () => {
  const conversation = cafeScenario.initial('conversation');
  const original = cafeScenario.frame(conversation);
  const story = cafeScenario.frame(cafeScenario.initial('story'));
  expect(original.story.location).toBe('window-seat');
  expect(original.story.actions.some((action) => action.id === 'view-photo')).toBe(false);
  expect(original.story.actions.some((action) => action.kind === 'move')).toBe(false);
  expect(original.facts).toEqual({ rain_softened: false });
  expect(story.story.location).toBe('street-wide');
  expect(cafeScenario.canConverse!(conversation)).toBe(true);
  expect(cafeScenario.opening!(conversation).text).not.toBe(
    cafeScenario.opening!(cafeScenario.initial()).text,
  );
});

it('rejects the retired photo action without changing weather or story progress', () => {
  const checkpoint = cafeScenario.initial('conversation');
  const original = cafeScenario.frame(checkpoint);
  expect(() => cafeScenario.propose('view-photo', checkpoint)).toThrow();
  expect(cafeScenario.frame(checkpoint)).toEqual(original);
  expect(original.facts).toEqual({ rain_softened: false });
});

it('offers a continuous authored story route and rejects a recommendation from an old checkpoint', () => {
  let checkpoint = cafeScenario.initial('story');
  const route = ['move-cafe-front', 'move-lobby', 'talk-sit', 'talk-next-scene'];
  const opening = { kind: 'action' as const, actionId: route[0]!, revision: checkpoint.revision };
  for (const actionId of route) {
    expect(cafeScenario.frame(checkpoint).story.actions[0]?.id).toBe(actionId);
    for (const beat of cafeScenario.propose(
      { kind: 'action', actionId, revision: checkpoint.revision },
      checkpoint,
    ))
      checkpoint = cafeScenario.accept(checkpoint, beat.checkpoint);
  }
  expect(cafeScenario.frame(checkpoint).story.beat).toBe('first-coffee');
  expect(() => cafeScenario.propose(opening, checkpoint)).toThrow();
});
