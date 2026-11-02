import { describe, expect, it } from 'vitest';
import { cafeScenario } from './index.js';
import {
  advance,
  followTo,
  firstEncounter,
  firstNight,
  secondMeeting,
} from './story.test.helpers.js';

// Regression sources only; not executed without explicit user authorization.
const frame = (state: Parameters<typeof cafeScenario.frame>[0]) => cafeScenario.frame(state);
const ids = (state: Parameters<typeof cafeScenario.frame>[0]) =>
  frame(state).story.actions.map((action) => action.id);
describe('event-based encounters and independent relationship decisions', () => {
  it('does not infer affection from sitting down, chapter completion or optional props', () => {
    const state = advance(
      firstEncounter(),
      'talk-sit',
      'inspect-coffee',
      'talk-game',
      'talk-game-third',
    );
    expect(frame(state).story.beat).toBe('first-small-talk');
    expect(frame(state).story.milestones).not.toContain('chemistry');
    const ending = firstNight();
    for (const flag of ['trust', 'chemistry', 'overnight', 'appointment'])
      expect(frame(ending).story.milestones).not.toContain(flag);
    expect(ids(ending)).not.toContain('choose-night');
  });
  it('keeps the player outside the private cutaway and rejects stale return checkpoints', () => {
    const shared = advance(firstEncounter(), 'talk-sit');
    const proposed = cafeScenario.propose('talk-wait-seat', shared);
    let state = shared;
    for (const beat of proposed) state = cafeScenario.accept(state, beat.checkpoint);
    expect(frame(state).story.location).toBe('window-seat');
    expect(frame(state).story.shot).toEqual({ location: 'washroom', mode: 'character' });
    const next = cafeScenario.propose('talk-next-scene', state);
    const left = advance(state, 'choose-farewell');
    expect(frame(left).story.shot?.mode).toBe('shared');
    expect(() => cafeScenario.accept(left, next[0]!.checkpoint)).toThrow();
  });
  it('keeps explicit mutual decisions behind character review and the actual presentation receipt', () => {
    const before = firstNight();
    expect(cafeScenario.actionReview!(before, 'talk-spark')).toBeTruthy();
    // Proposals here stand in for a successfully reviewed action; only Graph may execute them.
    const interested = advance(before, 'talk-spark');
    const offer = advance(interested, 'choose-night');
    expect(cafeScenario.actionReview!(offer, 'choose-night-confirm')).toBeTruthy();
    expect(frame(offer).story.milestones).not.toContain('overnight');
    const proposed = cafeScenario.propose('choose-night-confirm', offer);
    const faded = cafeScenario.accept(offer, proposed[0]!.checkpoint);
    expect(frame(faded).story.shot?.mode).toBe('blackout');
    expect(frame(faded).story.milestones).not.toContain('overnight');
    const declined = advance(faded, 'choose-night-decline');
    expect(() => cafeScenario.accept(declined, proposed[1]!.checkpoint)).toThrow();
    const spent = cafeScenario.accept(faded, proposed[1]!.checkpoint);
    expect(frame(spent).story.milestones).toContain('overnight');
    expect(frame(spent).story.milestones).not.toContain('appointment');
  });
  it('respects a slow-down request without turning ordinary conversation into reopening', () => {
    const interested = advance(firstNight(), 'talk-spark');
    const slower = advance(interested, 'talk-boundary');
    expect(ids(slower)).not.toContain('choose-night');
    expect(ids(slower)).toContain('talk-reopen');
    expect(cafeScenario.actionReview!(slower, 'talk-reopen')).toBeTruthy();
    expect(ids(advance(slower, 'talk-reopen'))).toContain('choose-night');
  });
  it('keeps a non-romantic second meeting outdoors and offers a complete friend ending', () => {
    const initial = secondMeeting();
    expect(frame(initial).story).toMatchObject({
      location: 'cafe-front',
      beat: 'second-greeting',
      ambience: 'closed',
    });
    for (const id of ['move-lobby', 'move-counter', 'move-window-seat', 'choose-hand'])
      expect(ids(initial)).not.toContain(id);
    const ending = followTo(initial, 'second-choice');
    expect(frame(ending).story.milestones).not.toContain('chemistry');
    const friends = advance(ending, 'choose-date-friends');
    expect(frame(friends).story.ending).toBe('friends');
    expect(ids(friends)).not.toContain('choose-hug');
    expect(cafeScenario.actionReview!(ending, 'choose-date-close')).toBeTruthy();
  });
});
