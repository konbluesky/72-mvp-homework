import { describe, expect, it } from 'vitest';
import { cafeScenario } from './index.js';
import { advance, firstEncounter, firstNight, followTo } from './story.test.helpers.js';

describe('authored long-form cafe story', () => {
  it('starts at the first encounter with a valid exit, not unlocked relationship endings', () => {
    const state = cafeScenario.initial();
    const frame = cafeScenario.frame(state);
    expect(frame.story).toMatchObject({
      location: 'street-wide',
      beat: 'arrival-street',
      phase: 'arrival',
    });
    expect(frame.story.milestones).not.toContain('met');
    expect(cafeScenario.canConverse!(state)).toBe(false);
    expect(frame.story.actions.map((action) => action.id)).toContain('move-cafe-front');
    expect(frame.story.actions.map((action) => action.id)).toContain('choose-farewell');
    for (const id of ['move-lobby', 'move-window-seat', 'move-washroom', 'talk-sit'])
      expect(() => cafeScenario.propose(id, state)).toThrow();
    expect(() => cafeScenario.propose('choose-depart', state)).toThrow();
    expect(() => cafeScenario.propose('choose-night', state)).toThrow();
    expect(cafeScenario.frame(JSON.parse(JSON.stringify(state)))).toEqual(frame);
  });
  it('establishes arrival before the greeting and keeps optional notice reading separate from meeting', () => {
    const outside = advance(cafeScenario.initial(), 'move-cafe-front');
    const notice = cafeScenario.propose('inspect-notice', outside);
    expect(notice.every((beat) => !beat.line)).toBe(true);
    const reading = advance(outside, 'inspect-notice');
    expect(cafeScenario.frame(reading).story.milestones).not.toContain('met');
    const entry = cafeScenario.propose('move-lobby', reading);
    expect(entry[0]!.event).toMatchObject({ type: 'location', location: 'lobby' });
    expect(entry[0]!.line).toBeUndefined();
    expect(entry[1]!.line?.text).toBe('你好，这边还有个空位。');
    expect(cafeScenario.canConverse!(reading)).toBe(false);
    const entered = cafeScenario.accept(reading, entry[0]!.checkpoint);
    expect(cafeScenario.canConverse!(entered)).toBe(true);
    expect(cafeScenario.frame(entered).story.milestones).not.toContain('companionship');
    expect(() => cafeScenario.propose('move-window-seat', entered)).toThrow();
    const seated = advance(entered, 'talk-sit');
    expect(cafeScenario.frame(seated).story.location).toBe('window-seat');
    expect(cafeScenario.frame(seated).story.milestones).toContain('companionship');
  });
  it('allows leaving before meeting without inventing a shared goodbye', () => {
    const outside = cafeScenario.initial();
    const goodbye = cafeScenario.propose('choose-farewell', outside);
    expect(goodbye.every((beat) => !beat.line)).toBe(true);
    const left = advance(outside, 'choose-farewell');
    expect(cafeScenario.frame(left).story.milestones).not.toContain('met');
    expect(cafeScenario.canConverse!(left)).toBe(false);
  });
  it('keeps a non-progressing chat reply beside a concrete story opportunity', () => {
    const state = advance(firstEncounter(), 'talk-sit');
    expect(cafeScenario.suggestions!(state)).toEqual([]);
    expect(cafeScenario.frame(state).story.actions[0]?.id).toBe('talk-next-scene');
    expect(JSON.stringify(cafeScenario.context(state, []).scene)).not.toContain('replyCandidates');
  });
  it('does not turn optional menu presentation into trust, attraction or chapter progress', () => {
    let state = followTo(cafeScenario.initial(), 'first-counter');
    const originalBeat = cafeScenario.frame(state).story.beat;
    const originalMilestones = cafeScenario.frame(state).story.milestones;
    const proposal = cafeScenario.propose('inspect-menu', state);
    expect(cafeScenario.frame(state).story.revealed).not.toContain('menu');
    state = cafeScenario.accept(state, proposal[0]!.checkpoint);
    expect(cafeScenario.frame(state).story.revealed).toContain('menu');
    expect(cafeScenario.frame(state).story.beat).toBe(originalBeat);
    expect(cafeScenario.frame(state).story.milestones).toEqual(originalMilestones);
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
