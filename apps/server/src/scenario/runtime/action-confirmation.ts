import type { PlanInput } from '../../providers/types.js';
import type { StoryAction } from '@mira/protocol';

/** A separate Graph pass reviews consent; it cannot select a different action. */
export function actionConfirmationInput(input: PlanInput, action: StoryAction): PlanInput {
  return {
    ...input,
    allowedActions: [action],
    systemPrompt: `${input.systemPrompt ?? ''}
本次只复核用户是否明确要求执行下面唯一的动作。前一次规划结果不是用户同意，不能作为证据。
待复核动作：${JSON.stringify(action)}
独立阅读完整的当前userText，结合最近已呈现的对话判断。否定、假设、引用他人、讨论后果、请求解释、犹豫、多项冲突意图以及没有唯一对应提议的简短附和，都不是执行授权。不能抽取一句中的肯定片段而忽略整句的否定或条件。
仅在完整发言明确请求或确认这个动作时返回该actionId，actionRequest.confirmed=true、quote为完整userText，segments=[]、suggestions=[]。
否则actionId=null、actionRequest=null，segments用角色的一句自然问题澄清或跟随用户话题，不声称动作已执行；suggestions=[]。不得更换动作，不得生成世界事件。`,
  };
}
