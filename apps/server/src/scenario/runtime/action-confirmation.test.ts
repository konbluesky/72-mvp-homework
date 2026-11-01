import { describe, expect, it } from 'vitest';
import type { PlannerOutput, StoryAction } from '@mira/protocol';
import { authorizedPlannerAction } from './context.js';
import { actionConfirmationInput } from './action-confirmation.js';

const action: StoryAction = {
  id: 'choose-stay',
  kind: 'choose',
  explicit: true,
  label: '再坐一杯',
  description: '',
};
const decision = (text: string, confirmed = true): PlannerOutput => ({
  actionId: action.id,
  actionRequest: { quote: text, confirmed },
  segments: [],
  suggestions: [],
});

describe('server action consent boundary', () => {
  it('accepts the same complete player utterance independently of its input surface', () => {
    const text = '再陪你坐一杯吧。';
    expect(authorizedPlannerAction(decision(text), text, [action])).toBe(action);
    expect(authorizedPlannerAction(decision(text), ` ${text} `, [action])).toBe(action);
  });
  it('cannot cherry-pick an affirmative fragment from a refusal or hypothetical', () => {
    for (const text of ['不要再坐一杯', '如果再坐一杯，会怎样？', '她说“再坐一杯”，我还没决定']) {
      expect(authorizedPlannerAction(decision('再坐一杯'), text, [action])).toBeUndefined();
    }
  });
  it('requires confirmed intent, a current ID and a pure action proposal', () => {
    const text = '再坐一杯';
    expect(authorizedPlannerAction(decision(text, false), text, [action])).toBeUndefined();
    expect(authorizedPlannerAction(decision(text), text, [])).toBeUndefined();
    expect(
      authorizedPlannerAction({ ...decision(text), actionRequest: null }, text, [action]),
    ).toBeUndefined();
    expect(
      authorizedPlannerAction(
        {
          ...decision(text),
          segments: [{ text: '已完成。', emotion: 'curious', action: 'none', events: [] }],
        },
        text,
        [action],
      ),
    ).toBeUndefined();
    expect(
      authorizedPlannerAction(decision(text, false), text, [{ ...action, explicit: false }]),
    ).toBeUndefined();
  });
  it('constrains independent confirmation to one current action and preserves full context', () => {
    const input = {
      text: '好',
      history: [{ role: 'assistant' as const, text: '出去，还是再坐会儿？' }],
      facts: [],
      allowedActions: [action],
    };
    const review = actionConfirmationInput(input, action);
    expect(review.text).toBe(input.text);
    expect(review.history).toBe(input.history);
    expect(review.allowedActions).toEqual([action]);
    expect(review.systemPrompt).toContain('没有唯一对应提议');
    expect(review.systemPrompt).toContain('前一次规划结果不是用户同意');
  });
});
