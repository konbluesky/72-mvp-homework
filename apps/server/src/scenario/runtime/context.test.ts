import { describe, expect, it } from 'vitest';
import { filterSuggestions, validateReply } from './context.js';
import { cafeScenario } from '../cafe/index.js';

describe('scenario context and soft suggestions', () => {
  it('keeps chat suggestions independent of Ink choices and filters unavailable or excessive guidance', () => {
    const actions = cafeScenario.frame(cafeScenario.initial()).story.actions;
    const suggestions = [
      { label: '聊聊', draft: '雨夜的咖啡馆是什么样的？', kind: 'chat', relatedActionId: null },
      {
        label: '窗边',
        draft: '我们去窗边坐坐吧。',
        kind: 'explore',
        relatedActionId: 'move-window-seat',
      },
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
    ).toEqual(['聊聊', '窗边']);
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

it('binds only scenario-authored requests to interactions, preserving the checkpoint revision', () => {
  const checkpoint = cafeScenario.initial('story');
  const authored = cafeScenario.suggestions!(checkpoint);
  const guide = authored.find((item) => item.interaction?.kind === 'action')!;
  if (guide.interaction?.kind !== 'action') throw new Error('Expected authored action');
  const frame = cafeScenario.frame(checkpoint);
  const filtered = filterSuggestions(
    [
      {
        label: '改写',
        draft: '如果这样做会怎样？',
        kind: 'explore',
        relatedActionId: guide.interaction.actionId,
      },
      { label: '聊天', draft: '我也喜欢雨声。', kind: 'chat', relatedActionId: null },
    ],
    frame.story.actions,
    frame.story.phase,
    frame.recommendationPolicy,
    authored,
  );
  expect(filtered[0]).toEqual(guide);
  expect(filtered[1]).not.toHaveProperty('interaction');
  expect(
    filterSuggestions(
      [{ label: '不可用', draft: '读信吧。', kind: 'explore', relatedActionId: 'inspect-letter' }],
      frame.story.actions,
      frame.story.phase,
      frame.recommendationPolicy,
      authored,
    ),
  ).toEqual([]);
});
