import type { ReplyPlan } from '@mira/protocol';
export const transcriptResponse = (text = '能看看照片吗？') => ({
  metadata: { request_id: 'stt-request', duration: 0.5, channels: 1, models: ['fixture-model'] },
  results: { channels: [{ alternatives: [{ transcript: text, confidence: 0.99, words: [] }] }] },
});
export function plannerResponse(plan: ReplyPlan): Response {
  return Response.json({
    id: 'chat-completion',
    object: 'chat.completion',
    created: 1,
    model: 'test-model',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content: JSON.stringify(plan) },
      },
    ],
  });
}
