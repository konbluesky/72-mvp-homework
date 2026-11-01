import { describe, expect, it } from 'vitest';
import { cafeScenario } from './index.js';
import { advance, followTo, firstNight, secondMeeting } from './story.test.helpers.js';

// Regression sources only: execution requires explicit user authorization.
const frame = (state: Parameters<typeof cafeScenario.frame>[0]) => cafeScenario.frame(state);
const ids = (state: Parameters<typeof cafeScenario.frame>[0]) =>
  frame(state).story.actions.map((x) => x.id);
describe('long encounters, independent viewpoint and adult relationship choices', () => {
  it('does not let three conversations substitute for the full first encounter', () => {
    const state = advance(cafeScenario.initial(), 'talk-a01-1', 'talk-a01-2', 'talk-a01-3');
    for (const id of ['choose-depart', 'choose-night', 'choose-reunion', 'choose-appointment'])
      expect(ids(state)).not.toContain(id);
    expect(ids(state)).toContain('choose-farewell');
  });
  it('separates a private makeup shot from the player location and rejects its stale completion', () => {
    const before = followTo(cafeScenario.initial(), 'a05-2');
    const proposed = cafeScenario.propose('talk-a05-2', before);
    expect(frame(before).story.shot?.mode).toBe('shared');
    const privateView = cafeScenario.accept(before, proposed[0]!.checkpoint);
    expect(frame(privateView).story.location).toBe('window-seat');
    expect(frame(privateView).story.shot).toEqual({ location: 'washroom', mode: 'character' });
    const next = cafeScenario.propose('talk-a05-3', privateView);
    const left = advance(privateView, 'choose-farewell');
    expect(frame(left).story.shot?.mode).toBe('shared');
    expect(() => cafeScenario.accept(left, next[0]!.checkpoint)).toThrow();
  });
  it('requires two explicit steps and the fade receipt before recording a shared night', () => {
    const offer = advance(firstNight(), 'choose-night');
    expect(frame(offer).story.milestones).not.toContain('overnight');
    const proposed = cafeScenario.propose('choose-night-confirm', offer);
    const faded = cafeScenario.accept(offer, proposed[0]!.checkpoint);
    expect(frame(faded).story.shot?.mode).toBe('blackout');
    expect(frame(faded).story.milestones).not.toContain('overnight');
    const declined = advance(faded, 'choose-night-decline');
    expect(frame(declined).story.shot?.mode).toBe('shared');
    expect(frame(declined).story.milestones).not.toContain('overnight');
    expect(() => cafeScenario.accept(declined, proposed[1]!.checkpoint)).toThrow();
    const spent = cafeScenario.accept(faded, proposed[1]!.checkpoint);
    expect(frame(spent).story.milestones).toContain('overnight');
    expect(frame(spent).story.milestones).not.toContain('appointment');
    expect(ids(spent)).not.toContain('choose-reunion');
  });
  it('preserves boundaries without awarding intimacy for a game or elapsed conversations', () => {
    const slower = advance(firstNight(), 'talk-boundary');
    expect(ids(slower)).not.toContain('choose-night');
    expect(ids(advance(slower, 'talk-reopen'))).toContain('choose-night');
    const question = followTo(cafeScenario.initial(), 'a02-4');
    const wrong = advance(question, 'talk-game-first');
    const right = advance(question, 'talk-a02-4');
    expect(frame(wrong).story.milestones).toEqual(frame(right).story.milestones);
    expect(frame(wrong).story.milestones).not.toContain('chemistry');
  });
  it('keeps the second meeting outdoors and offers a full ending without physical contact', () => {
    const initial = secondMeeting();
    expect(frame(initial).story).toMatchObject({
      location: 'cafe-front',
      beat: 'b01-1',
      ambience: 'closed',
    });
    expect(frame(initial).facts.rain_softened).toBe(false);
    for (const id of ['move-lobby', 'move-counter', 'move-window-seat'])
      expect(ids(initial)).not.toContain(id);
    const ending = followTo(initial, 'b-ending');
    const closer = advance(ending, 'choose-date-close');
    expect(frame(closer).story.ending).toBe('closer');
    expect(frame(closer).story.milestones).not.toContain('handheld');
    expect(ids(closer)).not.toContain('choose-reunion');
    const friends = advance(ending, 'choose-date-friends');
    expect(frame(friends).story.ending).toBe('friends');
    expect(ids(friends)).not.toContain('choose-hug');
  });
  it('backs the length target with distinct presented dialogue rather than a timer', () => {
    let state = cafeScenario.initial();
    let spoken = '';
    let turns = 0;
    for (const target of ['a-ending', 'b-ending']) {
      for (let guard = 0; frame(state).story.beat !== target && guard < 90; guard++) {
        const action = `talk-${frame(state).story.beat}`;
        for (const beat of cafeScenario.propose(action, state)) {
          spoken += beat.line?.text ?? '';
          state = cafeScenario.accept(state, beat.checkpoint);
        }
        turns++;
      }
      expect(frame(state).story.beat).toBe(target);
      if (target === 'a-ending')
        state = advance(state, 'choose-appointment', 'choose-depart', 'choose-reunion');
    }
    expect(turns).toBeGreaterThanOrEqual(70);
    expect((spoken.match(/[\u4e00-\u9fff]/g) ?? []).length).toBeGreaterThanOrEqual(5300);
  });
});
