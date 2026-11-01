import { describe, expect, it } from 'vitest';
import type { StoryAction } from '@mira/protocol';
import { MockPlanner } from './mock.js';
import manifest from './manifest.json' with { type: 'json' };

const actions: StoryAction[] = ['choose-depart', 'choose-letter', 'inspect-letter'].map((id) => ({
  id,
  kind: id === 'inspect-letter' ? 'inspect' : 'choose',
  explicit: true,
  label: id,
  description: '',
}));
const plan = (text: string) =>
  new MockPlanner().plan(
    { text, history: [], facts: [], allowedActions: actions },
    new AbortController().signal,
  );

describe('offline conversational consent fixtures', () => {
  it('recognizes the authored decision containing 告别 as an affirmative, not a 别 refusal', async () => {
    expect(await plan(manifest.playerReplies['choose-letter'])).toMatchObject({
      actionId: 'choose-letter',
      actionRequest: { confirmed: true },
      segments: [],
    });
  });
  it.each([
    '不要打开信',
    '如果打开信会怎样？',
    '我们一起出去走走是什么意思？',
    '好',
    '她说我们一起离开，但我没决定',
  ])('does not execute ambiguous, hypothetical or rejected input: %s', async (text) => {
    expect(await plan(text)).toMatchObject({ actionId: null, actionRequest: null });
  });
});
