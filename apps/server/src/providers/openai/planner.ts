import { ChatOpenAI } from '@langchain/openai';
import { PlannerOutputSchema } from '@mira/protocol';
import { z } from 'zod';
import type { Config } from '../../config/index.js';
import { PLANNER_RULES } from '../../scenario/runtime/context.js';
import { withTimeout, type Fetch } from '../http.js';
import {
  ProviderError,
  type PlanInput,
  type ReplyPlanner,
  type ProviderInfo,
  type ProviderFailure,
} from '../types.js';

type PlannerOptions = Pick<
  Config,
  | 'GPT_API_KEY'
  | 'GPT_MODEL'
  | 'GPT_BASE_URL'
  | 'GPT_API_STYLE'
  | 'GPT_STRUCTURED_OUTPUT'
  | 'GPT_TIMEOUT_MS'
  | 'GPT_MAX_OUTPUT_TOKENS'
  | 'GPT_MAX_RETRIES'
  | 'GPT_HEADERS_JSON'
  | 'GPT_EXTRA_BODY_JSON'
>;
export class GptPlanner implements ReplyPlanner {
  readonly info: ProviderInfo;
  constructor(
    private readonly config: PlannerOptions,
    private readonly fetcher: Fetch = fetch,
  ) {
    this.info = { provider: 'openai-compatible', model: config.GPT_MODEL };
  }
  plan(input: PlanInput, signal: AbortSignal): Promise<unknown> {
    let details: ProviderFailure = { provider: this.info.provider };
    return withTimeout(signal, this.config.GPT_TIMEOUT_MS, async (combined) => {
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(this.config.GPT_HEADERS_JSON))
        if (typeof value === 'string') headers[key] = value;
      const extra = z
        .object({ temperature: z.number().optional(), top_p: z.number().optional() })
        .parse(this.config.GPT_EXTRA_BODY_JSON);
      const model = new ChatOpenAI({
        apiKey: this.config.GPT_API_KEY,
        model: this.config.GPT_MODEL,
        useResponsesApi: this.config.GPT_API_STYLE === 'responses',
        maxTokens: this.config.GPT_MAX_OUTPUT_TOKENS,
        maxRetries: this.config.GPT_MAX_RETRIES,
        ...(extra.temperature === undefined ? {} : { temperature: extra.temperature }),
        ...(extra.top_p === undefined ? {} : { topP: extra.top_p }),
        timeout: this.config.GPT_TIMEOUT_MS,
        configuration: {
          baseURL: this.config.GPT_BASE_URL,
          defaultHeaders: headers,
          fetch: async (url, options) => {
            const response = await this.fetcher(url, options);
            const rawId = response.headers.get('x-request-id');
            const requestId = rawId && /^[a-zA-Z0-9_-]{1,128}$/.test(rawId) ? rawId : undefined;
            details = {
              provider: this.info.provider,
              status: response.status,
              ...(requestId ? { requestId } : {}),
              retryable: response.status === 429 || response.status >= 500,
            };
            return response;
          },
        },
      });
      const method = {
        json_schema: 'jsonSchema',
        json_mode: 'jsonMode',
        function_calling: 'functionCalling',
      } as const;
      const actions = (input.allowedActions ?? []).map((action) => action.id);
      const schema = z.toJSONSchema(
        PlannerOutputSchema.extend({
          mediaDecision: PlannerOutputSchema.shape.mediaDecision.unwrap(),
          actionId: actions.length
            ? z.enum([actions[0]!, ...actions.slice(1)]).nullable()
            : z.null(),
        }),
      );
      const prompt =
        (input.systemPrompt ?? PLANNER_RULES) +
        '\nimageSharing 是服务端依据已确认场景和交流进度授予的角色主动表达机会，独立于需要用户同意的剧情 actionId。candidate.available=true 表示本次主动准备图片已获场景许可；title、originLabel、sharingIntention说明角色想留下的这一刻。用户无需先要求看照片、画图或确认生图。普通闲聊且用户没有拒绝、转移到不适合分享的话题时，优先选择 prepare 一次，并给出完整的有限 intent；不要仅因用户没提照片而选择 defer。prepare 时 segments 正常承接用户，服务端会附加场景编写的准备台词，不要重复宣告或声称图片已经完成。确实需要暂缓时 defer；用户拒绝分享或取消照片时 dismiss；已宣布准备中的任务选择 keep，不重复创建。candidate为空不得 prepare。所有地点、亲密、剧情选择仍遵守原 actionId 同意规则；此能力不授予其他剧情权限，不编造图片内容、网址、人物身份或工作流。';
      const systemPrompt =
        this.config.GPT_STRUCTURED_OUTPUT === 'json_mode'
          ? `${prompt}\n严格按照下方 JSON Schema 输出一个完整的 ReplyPlan JSON 对象。必须包含所有必填字段，只使用声明的字段和枚举值，不得添加额外字段。不要输出 Markdown 代码块、解释或 JSON 之外的文字。\nReplyPlan JSON Schema:\n${JSON.stringify(schema)}`
          : prompt;
      const structured = model.withStructuredOutput(schema, {
        name: 'character_reply',
        includeRaw: true,
        method: method[this.config.GPT_STRUCTURED_OUTPUT],
        ...(this.config.GPT_STRUCTURED_OUTPUT === 'json_mode' ? {} : { strict: true }),
      });
      const result = await structured.invoke(
        [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: JSON.stringify({
              userText: input.text,
              committedHistory: input.history,
              committedFacts: input.facts,
              scene: input.scene,
              imageSharing: input.mediaCandidate ?? null,
              allowedActions: input.allowedActions ?? [],
              ...(input.repair === undefined
                ? {}
                : {
                    repair:
                      typeof input.repair === 'string'
                        ? input.repair
                        : 'Previous output did not meet the reply schema. Return a valid reply plan once.',
                  }),
            }),
          },
        ],
        { signal: combined },
      );
      // Parsing failures return null so the Graph, not an SDK retry loop, owns the single repair.
      return result.parsed;
    }).catch((error: unknown) => {
      if (error instanceof ProviderError)
        throw new ProviderError(error.code, error.message, {
          ...details,
          ...error.details,
          ...(error.code === 'PROVIDER_TIMEOUT' ? { retryable: true } : {}),
        });
      throw error;
    });
  }
}
