import { describe, expect, it } from 'vitest';
import { filterSuggestions, validateReply } from './context.js';
import { cafeScenario } from '../cafe/index.js';

describe('scenario context and soft suggestions', () => {
  it('keeps chat suggestions independent of Ink choices and filters unavailable or excessive guidance', () => {
    const actions = cafeScenario.frame(cafeScenario.initial()).story.actions;
    const suggestions = [
      { label: '聊聊', draft: '雨夜的咖啡馆是什么样的？', kind: 'chat', relatedActionId: null },
      { label: '进店', draft: '我想进店坐会儿。', kind: 'explore', relatedActionId: 'move-lobby' },
      { label: '再引导', draft: '去门口吧。', kind: 'explore', relatedActionId: 'move-cafe-front' },
      {
        label: '结局',
        draft: '我们一起离开。',
        kind: 'decision',
        relatedActionId: 'choose-depart',
      },
    ];
    expect(
      filterSuggestions(suggestions, actions, 'arrival', {
        decisionPhases: ['decision', 'epilogue'],
        maxGuiding: 1,
      }).map((item) => item.label),
    ).toEqual(['聊聊', '进店']);
  });
  it('does not give the model unrevealed prop text or require every conversation to progress', () => {
    const state = cafeScenario.initial();
    const context = cafeScenario.context(state, [{ role: 'user', text: '先不追问，聊聊旅行吧。' }]);
    expect(JSON.stringify(context.scene)).not.toContain('我下午来过');
    expect(context.systemPrompt).toContain('不要求每轮推进剧情');
    expect(context.systemPrompt).toContain('否定、假设、询问后果不执行');
  });
  it('rejects model world mutations while allowing ordinary character expression', () => {
    const plan = {
      segments: [
        { text: '听你说。', emotion: 'curious' as const, action: 'none' as const, events: [] },
      ],
      suggestions: [],
    };
    expect(() => validateReply(plan)).not.toThrow();
    expect(() =>
      validateReply({
        ...plan,
        segments: [
          { ...plan.segments[0]!, events: [{ type: 'photo', resourceId: 'travel_photo_01' }] },
        ],
      }),
    ).toThrow();
  });
});
