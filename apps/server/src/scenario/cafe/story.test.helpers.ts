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
  for (let steps = 0; steps < 40; steps++) {
    if (cafeScenario.frame(state).story.beat === target) return state;
    state = advance(state, 'talk-next-scene');
  }
  throw new Error('Authored route did not converge');
}
export function firstEncounter() {
  return followTo(cafeScenario.initial('story'), 'first-greeting');
}
export function firstNight() {
  return followTo(cafeScenario.initial('story'), 'first-choice');
}
export function secondMeeting() {
  // This helper models already-reviewed choices; Graph separately verifies character willingness.
  return advance(firstNight(), 'choose-appointment', 'choose-depart', 'choose-reunion');
}
