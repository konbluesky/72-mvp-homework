import { expect, it } from 'vitest';
import { cafeScenario } from './index.js';

it('keeps free conversation available before companionship and after optional story beats', () => {
  let checkpoint = cafeScenario.initial('conversation');
  expect(cafeScenario.frame(checkpoint).story.milestones).not.toContain('companionship');
  expect(cafeScenario.canConverse!(checkpoint)).toBe(true);
  for (const action of ['talk-waiting']) {
    for (const beat of cafeScenario.propose(action, checkpoint))
      checkpoint = cafeScenario.accept(checkpoint, beat.checkpoint);
    expect(cafeScenario.canConverse!(checkpoint)).toBe(true);
    expect(cafeScenario.frame(checkpoint).story.milestones).not.toContain('companionship');
  }
  expect(cafeScenario.canConverse!(cafeScenario.initial('story'))).toBe(false);
});
