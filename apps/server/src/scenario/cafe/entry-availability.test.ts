import { expect, it } from 'vitest';
import { cafeScenario } from './index.js';
import { advance, firstEncounter } from './story.test.helpers.js';

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

it('keeps a generated keepsake viewable after moving while new requests still belong to the seat', () => {
  const seated = advance(firstEncounter(), 'talk-sit');
  const candidate = cafeScenario.imageSharing!.candidate(seated, [])!;
  const recipe = {
    ...candidate,
    intent: { focus: 'character' as const, mood: 'warm' as const, framing: 'medium' as const },
    seed: 1,
  };
  const corridor = advance(seated, 'move-photo-corridor');
  expect(cafeScenario.imageSharing!.candidate(corridor, [])).toBeUndefined();
  expect(cafeScenario.imageSharing!.accepts(corridor, recipe)).toBe(true);
  const privateView = advance(corridor, 'talk-wait-gallery');
  expect(cafeScenario.imageSharing!.accepts(privateView, recipe)).toBe(false);
});
