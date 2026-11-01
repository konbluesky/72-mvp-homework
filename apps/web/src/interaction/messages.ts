import { z } from 'zod';
import { IdSchema, StoryInteractionSchema, TurnIdentitySchema } from '@mira/protocol';

export const OutgoingMessageSchema = z
  .object({
    messageId: IdSchema,
    turn: TurnIdentitySchema,
    input: z.union([
      z.object({ text: z.string().trim().min(1).max(1000) }).strict(),
      z.object({ interaction: StoryInteractionSchema }).strict(),
    ]),
    status: z.enum(['sending', 'waiting', 'responding', 'completed', 'failed', 'interrupted']),
    started: z.boolean(),
    presented: z.boolean(),
    retryable: z.boolean(),
    error: z.string().max(240),
    visible: z.boolean().optional(),
  })
  .strict();
export const OutgoingMessagesSchema = z.array(OutgoingMessageSchema).max(60);
export type OutgoingMessage = z.infer<typeof OutgoingMessageSchema>;

export function messageStatusText(message?: OutgoingMessage): string {
  if (!message) return '';
  switch (message.status) {
    case 'sending':
      return '正在发送';
    case 'waiting':
      return '等待回复';
    case 'responding':
      return '正在回复';
    case 'failed':
      return '回复失败';
    case 'interrupted':
      return message.started || message.presented ? '回复中断' : '已中断';
    case 'completed':
      return '';
  }
}
