import { describe, expect, it } from 'vitest';
import { cafeScenario } from './index.js';
import { advance, firstEncounter, firstNight } from './story.test.helpers.js';
import type { StoryCheckpoint } from '../ports.js';

// Regression sources only; do not execute without explicit user authorization.
const frame = (state: StoryCheckpoint) => cafeScenario.frame(state).story;
function quickTo(state: StoryCheckpoint, target: string) {
  for (let n = 0; n < 24; n++) {
    if (frame(state).beat === target) return state;
    state = advance(state, 'talk-next-scene');
  }
  throw new Error('Progression destination was not reached');
}

describe('optional chapter progression shares the conversation checkpoint', () => {
  it('covers both meetings without manufacturing skipped conversation or attraction', () => {
    const ending = quickTo(cafeScenario.initial(), 'first-choice');
    expect(frame(ending).location).toBe('cafe-front');
    for (const flag of ['trust', 'chemistry', 'game_played', 'game_answered', 'overnight'])
      expect(frame(ending).milestones).not.toContain(flag);
    expect(frame(ending).milestones).toContain('makeup_returned');
    expect(frame(ending).actions.some((action) => action.id === 'talk-next-scene')).toBe(false);
    expect(frame(ending).actions.some((action) => action.id === 'choose-night')).toBe(false);
    const reunion = advance(ending, 'choose-appointment', 'choose-letter', 'choose-reunion');
    const finished = quickTo(reunion, 'second-choice');
    expect(frame(finished).milestones).not.toContain('date_finished');
    expect(frame(finished).milestones).not.toContain('handheld');
    expect(frame(finished).actions.some((action) => action.id === 'choose-date-friends')).toBe(
      true,
    );
  });
  it('can follow ordinary conversation and then return to it in the next segment', () => {
    const seated = advance(firstEncounter(), 'talk-sit');
    const coffee = advance(seated, 'talk-next-scene');
    expect(frame(coffee).beat).toBe('first-coffee');
    expect(frame(coffee).actions.some((action) => /^talk-[ab]\d/.test(action.id))).toBe(false);
    expect(frame(advance(coffee, 'talk-next-scene')).location).toBe('photo-corridor');
  });
  it('commits a shortcut only through presentation receipts and rejects a stale same-ID click', () => {
    const initial = cafeScenario.initial();
    const click = {
      kind: 'action' as const,
      actionId: 'talk-next-scene',
      revision: initial.revision,
    };
    const proposal = cafeScenario.propose(click, initial);
    expect(frame(initial).location).toBe('street-wide');
    const arrived = cafeScenario.accept(initial, proposal[0]!.checkpoint);
    expect(frame(arrived).location).toBe('cafe-front');
    expect(() => cafeScenario.propose(click, arrived)).toThrow();
  });
  it('keeps private camera movement separate from the player and requires the return receipt', () => {
    const mirror = quickTo(cafeScenario.initial(), 'first-mirror');
    expect(frame(mirror).location).toBe('window-seat');
    expect(frame(mirror).shot).toEqual({ location: 'washroom', mode: 'character' });
    const ready = advance(mirror, 'talk-next-scene');
    const returns = cafeScenario.propose('talk-next-scene', ready);
    const visible = cafeScenario.accept(ready, returns[0]!.checkpoint);
    expect(frame(visible).milestones).not.toContain('makeup_returned');
    expect(frame(visible).shot?.mode).toBe('shared');
    const returned = cafeScenario.accept(visible, returns[1]!.checkpoint);
    expect(frame(returned).milestones).toContain('makeup_returned');
    expect(frame(returned).milestones).not.toContain('chemistry');
  });
  it('does not skip consent branches, endings or the original conversation entry', () => {
    const offer = advance(advance(firstNight(), 'talk-spark'), 'choose-night');
    const closed = advance(firstNight(), 'choose-letter');
    for (const state of [offer, closed, cafeScenario.initial('conversation')])
      expect(() => cafeScenario.propose('talk-next-scene', state)).toThrow();
  });
});
