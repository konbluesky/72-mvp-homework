import type { PlanInput } from '../../providers/types.js';
import type { StoryAction, StoryInteraction } from '@mira/protocol';

export function interactionActionId(input: StoryInteraction): string {
  if (input.kind === 'image') return 'generate-image';
  return input.kind === 'action'
    ? input.actionId
    : input.kind === 'move'
      ? `move-${input.location}`
      : input.kind === 'inspect'
        ? `inspect-${input.prop}`
        : `choose-${input.ending}`;
}

/** A separate Graph pass reviews consent; it cannot select a different action. */
export function actionConfirmationInput(
  input: PlanInput,
  action: StoryAction,
  review: { characterCondition?: string; source?: 'speech' | 'choice' } = {},
): PlanInput {
  return {
    ...input,
    allowedActions: [action],
    systemPrompt: `${input.systemPrompt ?? ''}
本次独立复核下面唯一的动作。前一次规划结果不是用户同意，也不是角色愿意，不能作为证据。
待复核动作：${JSON.stringify(action)}
${review.source === 'choice' ? '当前userText是玩家点击的动作标签，并非玩家说出口的台词。点击只证明玩家提出该请求，不证明角色也愿意。' : ''}
独立阅读完整的当前userText，结合最近已呈现的对话判断。否定、假设、引用他人、讨论后果、请求解释、犹豫、多项冲突意图以及没有唯一对应提议的简短附和，都不是执行授权。不能抽取一句中的肯定片段而忽略整句的否定或条件。
${review.characterCondition ? `还必须判断角色自己的当下意愿：${review.characterCondition}\n以真实已呈现交流为依据，不按章节位置、按钮点击、聊天轮数或玩家单方面宣称推断她愿意。可以自然保留、拒绝或提出较慢的相处；不道德说教，不把谨慎写成生硬盘问。` : ''}
只有用户明确请求且所有角色意愿条件成立时，返回该actionId，actionRequest.confirmed=true、quote为完整userText，segments=[]、suggestions=[]。
否则actionId=null、actionRequest=null，segments用角色的一句自然回应表达保留、澄清或跟随用户话题，不声称动作已执行；suggestions=[]。mediaDecision必须为null。不得更换动作，不得生成世界事件。`,
  };
}
