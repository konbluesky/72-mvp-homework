// Authoring regression helper; never imported by production code.
import { cafeScenario } from './index.js';
import type { StoryCheckpoint } from '../ports.js';
export function advance(state: StoryCheckpoint, ...ids: string[]) {
  for (const id of ids)
    for (const beat of cafeScenario.propose(id, state))
      state = cafeScenario.accept(state, beat.checkpoint);
  return state;
}
export function followTo(state: StoryCheckpoint, target: string) {
  for (let steps = 0; steps < 90; steps++) {
    const beat = cafeScenario.frame(state).story.beat;
    if (beat === target) return state;
    if (!beat || !/^[ab]\d{2}-\d$/.test(beat)) throw new Error(`Cannot follow from ${beat}`);
    state = advance(state, `talk-${beat}`);
  }
  throw new Error('Authored route did not converge');
}
export function firstNight() {
  return followTo(cafeScenario.initial('story'), 'a-ending');
}
export function secondMeeting() {
  return advance(firstNight(), 'choose-appointment', 'choose-depart', 'choose-reunion');
}
