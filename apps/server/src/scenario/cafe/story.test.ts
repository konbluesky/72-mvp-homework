import { describe, expect, it } from 'vitest';
import { cafeScenario } from './index.js';
import { advance, firstNight } from './story.test.helpers.js';

describe('authored long-form cafe story', () => {
  it('starts at the first encounter with a valid exit, not unlocked relationship endings', () => {
    const state = cafeScenario.initial();
    const frame = cafeScenario.frame(state);
    expect(frame.story).toMatchObject({ location: 'lobby', beat: 'a01-1' });
    expect(frame.story.actions.map((action) => action.id)).toContain('choose-farewell');
    expect(() => cafeScenario.propose('choose-depart', state)).toThrow();
    expect(() => cafeScenario.propose('choose-night', state)).toThrow();
    expect(cafeScenario.frame(JSON.parse(JSON.stringify(state)))).toEqual(frame);
  });
  it('keeps a non-progressing chat reply beside a concrete story opportunity', () => {
    const state = advance(cafeScenario.initial(), 'talk-a01-1');
    const suggestions = cafeScenario.suggestions!(state);
    expect(suggestions[0]?.interaction).toMatchObject({ actionId: 'talk-a01-2' });
    expect(suggestions.some((item) => !item.interaction)).toBe(true);
  });
  it('does not turn optional letter presentation into trust, attraction or chapter progress', () => {
    let state = advance(cafeScenario.initial(), 'move-counter');
    const originalBeat = cafeScenario.frame(state).story.beat;
    const proposal = cafeScenario.propose('inspect-letter', state);
    expect(cafeScenario.frame(state).story.revealed).not.toContain('letter');
    state = cafeScenario.accept(state, proposal[0]!.checkpoint);
    expect(cafeScenario.frame(state).story.revealed).toContain('letter');
    expect(cafeScenario.frame(state).story.beat).toBe(originalBeat);
    expect(cafeScenario.frame(state).story.milestones).not.toContain('trust');
  });
  it('keeps an interrupted departure at its confirmed prefix without restoring old plans', () => {
    const original = firstNight();
    const proposal = cafeScenario.propose('choose-depart', original);
    let state = cafeScenario.accept(original, proposal[0]!.checkpoint);
    expect(cafeScenario.frame(state).story.ending).toBeNull();
    state = advance(state, 'move-window-seat');
    expect(() => cafeScenario.accept(state, proposal[1]!.checkpoint)).toThrow();
    expect(cafeScenario.frame(state).story.location).toBe('window-seat');
  });
});
