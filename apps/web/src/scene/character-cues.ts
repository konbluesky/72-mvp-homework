import type { Emotion, Interaction } from '@mira/protocol';

/** A visual projection only: cues never create interaction states or story receipts. */
export function characterCue(interaction: Interaction, emotion: Emotion) {
  if (interaction === 'listening')
    return { kind: 'listening', symbol: '◉', label: '认真听你说' } as const;
  if (interaction === 'thinking')
    return { kind: 'thinking', symbol: '···', label: '让我想想…' } as const;
  if (interaction === 'speaking')
    return { kind: 'speaking', symbol: '♪', label: '正在说话' } as const;
  return {
    kind: 'idle',
    symbol: emotion === 'curious' ? '！?' : emotion === 'relieved' ? '✧' : '✦',
    label:
      emotion === 'curious' ? '有点好奇！' : emotion === 'relieved' ? '放松下来啦' : '等你开口',
  } as const;
}
