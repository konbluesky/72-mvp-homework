import { expect, it } from 'vitest';
import { cafeScenario } from './index.js';

it('keeps the original conversation at its seat without requiring WebGAL navigation', () => {
  const conversation = cafeScenario.initial('conversation');
  const original = cafeScenario.frame(conversation);
  const story = cafeScenario.frame(cafeScenario.initial('story'));
  expect(original.story.location).toBe('window-seat');
  expect(original.story.actions.some((action) => action.id === 'view-photo')).toBe(true);
  expect(original.story.actions.some((action) => action.kind === 'move')).toBe(false);
  expect(original.facts).toEqual({ photo_revealed: false, rain_softened: false });
  expect(story.story.location).toBe('lobby');
});

it('keeps photo and rain receipts separate in the original page without changing the story path', () => {
  const original = cafeScenario.initial('conversation');
  const beats = cafeScenario.propose('view-photo', original);
  expect(beats.map((beat) => beat.event.type)).toEqual(['photo', 'environment']);
  expect(beats[0]!.frame.facts).toEqual({ photo_revealed: true, rain_softened: false });
  expect(beats[1]!.frame.facts).toEqual({ photo_revealed: true, rain_softened: true });
  expect(() => cafeScenario.accept(original, beats[1]!.checkpoint)).toThrow();
  const first = cafeScenario.accept(original, beats[0]!.checkpoint);
  expect(cafeScenario.frame(first).facts.rain_softened).toBe(false);
});
