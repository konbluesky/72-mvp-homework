import { readFile } from 'node:fs/promises';
import { ReplySuggestionsSchema, StoryStateSchema } from '@mira/protocol';
import manifest from './manifest.json' with { type: 'json' };

import type { PlanSegment, ReplyPlan } from '@mira/protocol';
import {
  ProviderError,
  type ProviderSet,
  type SpeechToTextProvider,
  type ReplyPlanner,
  type TextToSpeechProvider,
  type AudioData,
  type PlanInput,
} from '../../providers/types.js';

export const MOCK_LINES = Object.fromEntries(
  Object.entries(manifest.voices).map(([id, value]) => [id, value.text]),
) as { readonly [K in keyof typeof manifest.voices]: string };
// Explicitly simulated language matching; production interpretation stays inside the LLM graph.
function photoRequested(text: string): boolean {
  return (
    !/(不要|不想|不看|别).{0,6}(照片|相片)/u.test(text) &&
    /(看|给我|分享).{0,8}(照片|相片)/u.test(text)
  );
}
export const MOCK_TRANSCRIPT = manifest.mock.transcript;

function segment(
  text: string,
  emotion: PlanSegment['emotion'],
  action: PlanSegment['action'] = 'none',
  events: PlanSegment['events'] = [],
): PlanSegment {
  return { text, emotion, action, events };
}
function mockContent(text: string, facts: string[]): Pick<ReplyPlan, 'segments'> {
  // Refusal must win over a photo keyword; branch on content, never the turn count.
  if (/(不要|不想|不用|拒绝|别).{0,5}(照片|相片)|不看/.test(text))
    return { segments: [segment(MOCK_LINES.refuse, 'guarded')] };
  if (photoRequested(text))
    return {
      segments: [segment(MOCK_LINES.photo, 'relieved', 'offerPhoto', [])],
    };
  if (/(等谁|等什么|在等|伤心)/.test(text))
    return { segments: [segment(MOCK_LINES.waiting, 'guarded', 'lookWindow')] };
  if (/(旅行|海边|风景|远方|空乘|空姐|乘务|航班|飞行|工作|下班|休息)/.test(text))
    return { segments: [segment(MOCK_LINES.travel, 'curious', 'lookWindow')] };
  if (/(陪|没关系|谢谢|别难过|安慰|会好的)/.test(text))
    return { segments: [segment(MOCK_LINES.comfort, 'relieved')] };
  if (/(雨|天气)/.test(text))
    return {
      segments: [
        segment(
          facts.includes('rain_softened') ? MOCK_LINES.rain : MOCK_LINES.hello,
          'curious',
          'lookWindow',
          [],
        ),
      ],
    };
  if (facts.includes('photo_revealed'))
    return { segments: [segment(MOCK_LINES.after, 'relieved')] };
  return {
    segments: [
      segment(MOCK_LINES.hello, 'curious', 'acknowledge'),
      segment(MOCK_LINES.helloNext, 'curious'),
    ],
  };
}

/** Offline fixtures exercise the same suggestion protocol; Live choices come from the planner. */
export function mockPlan(text: string, facts: string[]): ReplyPlan {
  const content = mockContent(text, facts);
  const reply = content.segments[0]?.text;
  if (reply === MOCK_LINES.refuse)
    return {
      ...content,
      suggestions: [
        { label: '听一会儿雨', draft: '好，就这样安静坐一会儿吧。' },
        { label: '聊聊下班后', draft: '下班后你一般怎么放松？' },
      ],
    };
  if (reply === MOCK_LINES.waiting)
    return {
      ...content,
      suggestions: [
        { label: '问问那位朋友', draft: '你们有多久没见面了？' },
        { label: '陪她等一会儿', draft: '如果你愿意，我可以陪你再等一会儿。' },
      ],
    };
  if (reply === MOCK_LINES.travel)
    return {
      ...content,
      suggestions: [
        { label: '聊聊海边', draft: '那片海对你有什么特别的意义吗？' },
        { label: '说说我的旅行', draft: '我也有一段一直忘不了的旅行，想讲给你听。' },
      ],
    };
  if (reply === MOCK_LINES.photo || facts.includes('photo_revealed'))
    return {
      ...content,
      suggestions: [
        { label: '聊聊那次旅行', draft: '那次休息时去海边，最让你难忘的是什么？' },
        { label: '问问下一站', draft: '下次休息时，你想去哪里走走？' },
      ],
    };
  return {
    ...content,
    suggestions: [
      { label: '聊聊下班后', draft: '做空乘之外，你平时喜欢做些什么？' },
      { label: '陪她坐一会儿', draft: '我不赶时间，可以陪你聊一会儿。' },
    ],
  };
}
export class MockStt implements SpeechToTextProvider {
  readonly info = { provider: 'mock', model: 'example-transcript-v1' };
  async transcribe(_audio: AudioData, signal: AbortSignal) {
    signal.throwIfAborted();
    return { text: MOCK_TRANSCRIPT, simulated: true };
  }
}
export class MockPlanner implements ReplyPlanner {
  readonly info = { provider: 'mock', model: 'mira-branches-v1' };
  async plan(input: PlanInput, signal: AbortSignal) {
    signal.throwIfAborted();
    const actions = input.allowedActions ?? [];
    if (/(不聊|先不问|不追问|不想谈|不读|不看信|别打开|不要打开)/u.test(input.text)) {
      const plan = mockPlan('旅行', input.facts);
      return {
        ...plan,
        actionId: null,
        actionRequest: null,
        suggestions: plan.suggestions.map((item) => ({
          ...item,
          kind: 'chat',
          relatedActionId: null,
        })),
      };
    }
    const hesitant = /(如果|为什么|意味着|会怎样|不想|不要|别|不去|不看|先不|先别)/u.test(
      input.text,
    );
    const authored = actions.find(
      (action) =>
        manifest.playerReplies[action.id as keyof typeof manifest.playerReplies] === input.text,
    );
    let actionId: string | null = authored?.id ?? null;
    if (!authored && !hesitant) {
      if (/(打开|读一下|读这|读信|一起读).{0,8}(信|封)|打开吧/u.test(input.text))
        actionId = 'inspect-letter';
      else if (/(一起|决定|我们).{0,8}(出去走走|离开)/u.test(input.text))
        actionId = 'choose-depart';
      else if (/(留下|留封|写封).{0,8}(回信)/u.test(input.text)) actionId = 'choose-letter';
      else if (/(再坐一杯|再陪你坐)/u.test(input.text)) actionId = 'choose-stay';
      else if (photoRequested(input.text)) actionId = 'view-photo';
      else if (/(等谁|等什么|在等谁)/u.test(input.text)) actionId = 'talk-waiting';
      else if (/(陪你|陪我|坐一会|坐会儿)/u.test(input.text)) actionId = 'talk-companionship';
      else {
        const words: Record<string, string[]> = {
          counter: ['去吧台', '到吧台', '去结账台'],
          'window-seat': ['回窗边', '去座位'],
          lobby: ['去大堂', '走进店', '进入咖啡馆'],
          'photo-corridor': ['去走廊', '看照片墙'],
          washroom: ['去洗手', '去卫生间'],
        };
        for (const [location, phrases] of Object.entries(words))
          if (phrases.some((phrase) => input.text.includes(phrase))) actionId = `move-${location}`;
      }
    }
    const candidate = actions.find((action) => action.id === actionId);
    // Consequential offline fixtures accept authored affirmative utterances only.
    // Live semantic interpretation and independent confirmation remain inside Graph.
    if (candidate && (!candidate.explicit || authored?.id === candidate.id))
      return {
        actionId,
        actionRequest: { quote: input.text, confirmed: true },
        segments: [],
        suggestions: [],
      };
    const frame = StoryStateSchema.safeParse(
      input.scene && typeof input.scene === 'object'
        ? {
            ...Object.fromEntries(
              Object.entries(input.scene).filter(([key]) =>
                [
                  'location',
                  'revealed',
                  'ambience',
                  'ending',
                  'phase',
                  'revision',
                  'actions',
                  'milestones',
                ].includes(key),
              ),
            ),
            actions,
          }
        : undefined,
    );
    if (frame.success && /(阿岚|信件|那封信|她来过|等谁)/u.test(input.text)) {
      const line = frame.data.revealed.includes('letter')
        ? MOCK_LINES.letterKnown
        : MOCK_LINES.letterUnknown;
      return {
        actionId: null,
        actionRequest: null,
        segments: [segment(line, 'curious')],
        suggestions: [
          {
            label: '慢慢聊',
            draft: '不急，你想说什么我都愿意听。',
            kind: 'chat',
            relatedActionId: null,
          },
          {
            label: '聊聊旅行',
            draft: '有没有哪次旅行让你记了很久？',
            kind: 'chat',
            relatedActionId: null,
          },
        ],
      };
    }
    const plan = mockPlan(photoRequested(input.text) ? '旅行' : input.text, input.facts);
    const offered = ReplySuggestionsSchema.safeParse(
      input.scene && typeof input.scene === 'object' && 'replyCandidates' in input.scene
        ? input.scene.replyCandidates
        : [],
    );
    const guide = offered.success ? offered.data[0] : undefined;
    const related = guide
      ? actions.find(
          (action) =>
            manifest.playerReplies[action.id as keyof typeof manifest.playerReplies] ===
            guide.draft,
        )
      : undefined;
    return {
      ...plan,
      actionId: null,
      actionRequest: null,
      suggestions: [
        ...(guide && related
          ? [
              {
                ...guide,
                kind: related.kind === 'choose' ? 'decision' : 'explore',
                relatedActionId: related.id,
              },
            ]
          : []),
        ...plan.suggestions
          .slice(0, guide && related ? 1 : 2)
          .map((item) => ({ ...item, kind: 'chat', relatedActionId: null })),
      ],
    };
  }
}
export class MockTts implements TextToSpeechProvider {
  readonly info = { provider: 'mock', model: 'espeak-ng-cmn-fixtures' };
  async synthesize(text: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const voice = Object.values(manifest.voices).find((item) => item.text === text);
    if (!voice) throw new ProviderError('INVALID_AUDIO');
    const bytes = await readFile(
      new URL(`../../../../../${manifest.mock.audioRoot}/${voice.file}`, import.meta.url),
      { signal },
    );
    signal.throwIfAborted();
    return { bytes, mimeType: 'audio/wav' };
  }
}
export function createMockProviders(): ProviderSet & { stt: MockStt } {
  return { stt: new MockStt(), planner: new MockPlanner(), tts: new MockTts() };
}
