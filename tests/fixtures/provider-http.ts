import type { ReplyPlan, PlannerOutput } from '@mira/protocol';
export const transcriptResponse = (text = '能看看照片吗？') => ({
  metadata: { request_id: 'stt-request', duration: 0.5, channels: 1, models: ['fixture-model'] },
  results: { channels: [{ alternatives: [{ transcript: text, confidence: 0.99, words: [] }] }] },
});
/** Mock the private planner envelope while preserving intentionally invalid extra fields. */
export function plannerOutput(plan: ReplyPlan): PlannerOutput {
  return {
    ...plan,
    actionId: null,
    actionRequest: null,
    mediaDecision: null,
    suggestions: plan.suggestions.map(({ interaction: _interaction, ...item }) => ({
      ...item,
      kind: 'chat' as const,
      relatedActionId: null,
    })),
  } as PlannerOutput;
}
export function plannerResponse(plan: ReplyPlan): Response {
  const payload = 'actionId' in plan ? plan : plannerOutput(plan);
  return Response.json({
    id: 'chat-completion',
    object: 'chat.completion',
    created: 1,
    model: 'test-model',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content: JSON.stringify(payload) },
      },
    ],
  });
}
