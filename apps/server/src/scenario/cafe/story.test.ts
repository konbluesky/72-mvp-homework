import { describe, expect, it } from 'vitest';
import { cafeScenario } from './index.js';
import type { StoryCheckpoint } from '../ports.js';

function run(action: string, state: StoryCheckpoint) {
  let next = state;
  for (const beat of cafeScenario.propose(action, state))
    next = cafeScenario.accept(next, beat.checkpoint);
  return next;
}
describe('Ink authored cafe story', () => {
  it('offers real current choices and restores the same frame from a serialized checkpoint', () => {
    const state = cafeScenario.initial();
    const frame = cafeScenario.frame(state);
    expect(frame.story.phase).toBe('exploration');
    expect(frame.story.location).toBe('lobby');
    expect(cafeScenario.opening?.(state)?.suggestions.length).toBeGreaterThanOrEqual(2);
    expect(frame.story.actions.some((action) => action.id === 'choose-appointment')).toBe(false);
    expect(frame.story.actions.some((action) => action.id === 'choose-farewell')).toBe(true);
    expect(cafeScenario.frame(JSON.parse(JSON.stringify(state)))).toEqual(frame);
    expect(() => cafeScenario.propose('choose-depart', state)).toThrow();
  });
  it('keeps a natural non-progressing reply beside guidance after authored performances', () => {
    const state = run('talk-companionship', cafeScenario.initial());
    const replies = cafeScenario.suggestions?.(state) ?? [];
    expect(replies).toHaveLength(2);
    expect(replies[0]?.interaction).toMatchObject({ actionId: 'talk-game' });
    expect(replies.some((reply) => !reply.interaction)).toBe(true);
  });
  it('only exposes the letter after presentation without substituting it for personal trust', () => {
    let state = cafeScenario.initial();
    state = run('move-counter', state);
    expect(cafeScenario.frame(state).known.some((entry) => entry.id === 'letter')).toBe(false);
    const beats = cafeScenario.propose('inspect-letter', state);
    expect(cafeScenario.frame(state).story.revealed).not.toContain('letter');
    state = cafeScenario.accept(state, beats[0]!.checkpoint);
    expect(cafeScenario.frame(state).known.some((entry) => entry.id === 'letter')).toBe(true);
    expect(cafeScenario.frame(state).story.phase).toBe('exploration');
    state = cafeScenario.accept(state, beats[1]!.checkpoint);
    expect(cafeScenario.frame(state).story.phase).toBe('exploration');
    expect(cafeScenario.frame(state).story.milestones).not.toContain('trust');
  });
  it('allows companionship without reading and keeps an interrupted ending at its confirmed prefix', () => {
    let state = cafeScenario.initial();
    state = run('talk-companionship', state);
    expect(cafeScenario.frame(state).story.phase).toBe('exploration');
    state = run('talk-off-duty', state);
    expect(cafeScenario.frame(state).story.phase).toBe('decision');
    expect(cafeScenario.frame(state).known.some((entry) => entry.id === 'letter')).toBe(false);
    const beats = cafeScenario.propose('choose-depart', state);
    state = cafeScenario.accept(state, beats[0]!.checkpoint);
    expect(cafeScenario.frame(state).story.location).toBe('cafe-front');
    expect(cafeScenario.frame(state).story.ending).toBeNull();
    const fresh = cafeScenario.propose('move-window-seat', state);
    state = cafeScenario.accept(state, fresh[0]!.checkpoint);
    expect(() => cafeScenario.accept(state, beats[1]!.checkpoint)).toThrow();
    expect(() => cafeScenario.accept(state, beats[2]!.checkpoint)).toThrow();
    expect(cafeScenario.frame(state).story.location).toBe('window-seat');
  });
  it('rejects stale revision actions and incompatible story artifacts', () => {
    const state = run('move-counter', cafeScenario.initial());
    expect(() =>
      cafeScenario.propose({ kind: 'action', actionId: 'move-counter', revision: 0 }, state),
    ).toThrow();
    expect(() => cafeScenario.frame({ ...state, artifactHash: 'different' })).toThrow();
  });
});
