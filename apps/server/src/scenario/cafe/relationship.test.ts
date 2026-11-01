import { describe, expect, it } from 'vitest';
import { cafeScenario } from './index.js';
import type { StoryCheckpoint } from '../ports.js';

// Regression sources only: do not run runtime/functional tests without user authorization.
const frame = (state: StoryCheckpoint) => cafeScenario.frame(state);
const actions = (state: StoryCheckpoint) => frame(state).story.actions.map((action) => action.id);
function advance(state: StoryCheckpoint, ...ids: string[]): StoryCheckpoint {
  for (const id of ids) {
    for (const beat of cafeScenario.propose(id, state))
      state = cafeScenario.accept(state, beat.checkpoint);
  }
  return state;
}
function attracted() {
  return advance(cafeScenario.initial(), 'talk-companionship', 'talk-off-duty', 'talk-spark');
}
function reunion() {
  return advance(attracted(), 'choose-appointment', 'choose-depart', 'choose-reunion');
}

describe('two adult encounters and independent relationship choices', () => {
  it('does not turn company, optional props or a correct guess into a date', () => {
    const initial = cafeScenario.initial();
    const company = advance(initial, 'talk-companionship');
    const guessed = advance(company, 'talk-game', 'talk-game-third');
    const letter = advance(guessed, 'move-counter', 'inspect-letter');
    for (const state of [initial, company, guessed, letter]) {
      expect(actions(state)).not.toContain('choose-appointment');
      expect(actions(state)).not.toContain('choose-reunion');
      expect(actions(state)).not.toContain('choose-hand');
    }
    const honest = advance(letter, 'talk-off-duty');
    expect(actions(honest)).not.toContain('choose-appointment');
    expect(actions(advance(honest, 'talk-spark'))).toContain('choose-appointment');
  });

  it('lets wrong guesses reveal the same person without rewarding intimacy', () => {
    const question = advance(cafeScenario.initial(), 'talk-companionship', 'talk-game');
    expect(frame(question).known.some((entry) => entry.id === 'mira.game')).toBe(false);
    const wrong = advance(question, 'talk-game-first');
    const right = advance(question, 'talk-game-third');
    expect(frame(wrong).known).toEqual(frame(right).known);
    expect(actions(wrong)).toEqual(actions(right));
    expect(frame(wrong).story.milestones).not.toContain('chemistry');
  });

  it('keeps a slowed relationship distinct until the user explicitly reopens it', () => {
    const slower = advance(attracted(), 'talk-boundary');
    expect(actions(slower)).not.toContain('choose-appointment');
    expect(actions(slower)).toContain('choose-farewell');
    const reopened = advance(slower, 'talk-reopen');
    expect(frame(reopened).story.milestones).toEqual(
      expect.arrayContaining(['boundary_set', 'boundary_repaired']),
    );
    expect(actions(reopened)).toContain('choose-appointment');
    expect(actions(advance(reopened, 'talk-boundary'))).not.toContain('choose-appointment');
  });

  it('waits for an invitation receipt and a completed first-night ending before changing chapters', () => {
    const state = attracted();
    const invitation = cafeScenario.propose('choose-appointment', state);
    expect(frame(state).story.milestones).not.toContain('appointment');
    const invited = cafeScenario.accept(state, invitation[0]!.checkpoint);
    expect(frame(invited).story.revealed).toContain('appointment');
    expect(actions(invited)).not.toContain('choose-reunion');
    const ending = cafeScenario.propose('choose-depart', invited);
    const atDoor = cafeScenario.accept(invited, ending[0]!.checkpoint);
    expect(actions(atDoor)).not.toContain('choose-reunion');
    const finished = advance(invited, 'choose-depart');
    expect(actions(finished)).toContain('choose-reunion');
  });

  it('does not return a second date to a closed interior or inherit the first-night weather', () => {
    const state = reunion();
    expect(frame(state).story.location).toBe('cafe-front');
    expect(frame(state).story.ambience).toBe('closed');
    expect(frame(state).facts.rain_softened).toBe(false);
    for (const id of ['move-lobby', 'move-counter', 'move-window-seat', 'move-washroom'])
      expect(actions(state)).not.toContain(id);
    expect(actions(state)).not.toContain('choose-hand');
  });

  it('supports continuing to date without physical contact and stops offers after a friends ending', () => {
    const honest = advance(reunion(), 'talk-date-memory', 'talk-date-honest');
    expect(actions(honest)).toContain('choose-hand');
    const closer = advance(honest, 'choose-date-close');
    expect(frame(closer).story.ending).toBe('closer');
    expect(frame(closer).story.milestones).not.toContain('handheld');
    const friends = advance(honest, 'choose-date-friends');
    expect(frame(friends).story.ending).toBe('friends');
    for (const id of ['choose-hand', 'choose-date-close', 'choose-reunion', 'talk-reopen'])
      expect(actions(friends)).not.toContain(id);
  });

  it('keeps a proposed handhold uncommitted and lets the user stop intimacy in the second chapter', () => {
    const honest = advance(reunion(), 'talk-date-memory', 'talk-date-honest');
    const proposed = cafeScenario.propose('choose-hand', honest);
    expect(frame(honest).story.milestones).not.toContain('handheld');
    const boundary = advance(honest, 'talk-boundary');
    expect(actions(boundary)).not.toContain('choose-hand');
    expect(() => cafeScenario.accept(boundary, proposed[0]!.checkpoint)).toThrow();
    expect(frame(boundary).story.milestones).not.toContain('handheld');
  });
});
