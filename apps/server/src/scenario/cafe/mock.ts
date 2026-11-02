import type { PlanSegment, ReplyPlan } from '@mira/protocol';
import manifest from './manifest.json' with { type: 'json' };
import type {
  ProviderSet,
  SpeechToTextProvider,
  ReplyPlanner,
  AudioData,
  PlanInput,
} from '../../providers/types.js';

// Explicit offline planner fixtures, never Live dialogue or a speech implementation.
export const MOCK_LINES = {
  hello: manifest.voices.hello.text,
  helloNext: '我叫米拉。你怎么称呼？',
  waiting: '没有等人，我刚下班，在这里坐一会儿。',
  travel: '休息的时候，我喜欢慢慢走走。',
  comfort: '好，我们慢慢聊。',
  photo: '这张是无人海岸，休息时留下的纪念。',
  rain: '雨小了一点。',
  refuse: '好，那就不看。',
  after: '照片里是海岸、浪花和天空。',
} as const;
export const MOCK_TRANSCRIPT = manifest.mock.transcript;
export const MOCK_ACTION_UTTERANCES: Readonly<Record<string, string>> = {
  'talk-sit': '那我就在这边坐下。',
  'talk-companionship': '我愿意坐下聊聊。',
  'view-photo': '可以给我看看那张照片吗？',
  'inspect-menu': '我想看看饮品单。',
  'choose-letter': '今晚就在这里告别吧。',
  'choose-depart': '我们一起出去走走，再道别。',
  'move-counter': '我们去吧台看看吧。',
  'move-photo-corridor': '一起去看看走廊的风景画吧。',
  'move-cafe-front': '我想走到店门前。',
  'move-lobby': '我想推门进店。',
};
function segment(text: string, emotion: PlanSegment['emotion'] = 'curious'): PlanSegment {
  return { text, emotion, action: 'none', events: [] };
}
export function mockPlan(text: string, facts: string[]): ReplyPlan {
  let reply: string = MOCK_LINES.hello;
  if (/(不要|不想|不看|别).{0,8}(照片|相片)/u.test(text)) reply = MOCK_LINES.refuse;
  else if (/谢谢|陪/u.test(text)) reply = MOCK_LINES.comfort;
  else if (/等谁|等人/u.test(text)) reply = MOCK_LINES.waiting;
  else if (/旅行|海边|工作|下班/u.test(text)) reply = MOCK_LINES.travel;
  else if (/天气|雨/u.test(text))
    reply = facts.includes('rain_softened') ? MOCK_LINES.rain : MOCK_LINES.hello;
  else if (facts.includes('photo_revealed')) reply = MOCK_LINES.after;
  return {
    segments: [{ ...segment(reply), action: /天气|雨/u.test(text) ? 'lookWindow' : 'none' }],
    suggestions: [],
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
  readonly info = { provider: 'mock', model: 'scene-events-fixture-v2' };
  async plan(input: PlanInput, signal: AbortSignal) {
    signal.throwIfAborted();
    const empty = { actionId: null, actionRequest: null, suggestions: [] };
    if (input.systemPrompt?.includes('本次只为刚刚实际说完的回应'))
      return { ...empty, segments: [] };
    if (input.systemPrompt?.includes('还必须判断角色自己的当下意愿'))
      return { ...empty, segments: [segment('这件事我还想慢一点，我们先继续聊聊。')] };
    if (input.scene && typeof input.scene === 'object' && 'completedInteraction' in input.scene)
      return { ...empty, segments: [segment('嗯，我们接着聊。')] };
    const action = input.allowedActions?.find(
      (item) => MOCK_ACTION_UTTERANCES[item.id] === input.text,
    );
    if (action)
      return {
        actionId: action.id,
        actionRequest: { quote: input.text, confirmed: true },
        segments: [],
        suggestions: [],
      };
    const plan = mockPlan(input.text, input.facts);
    return {
      ...empty,
      ...plan,
      mediaDecision: input.mediaCandidate
        ? {
            decision: /(不要|不想|别|取消).{0,8}(拍|照片|纪念|分享)/u.test(input.text)
              ? 'dismiss'
              : 'prepare',
            intent: { focus: 'character', mood: 'quiet', framing: 'medium' },
          }
        : null,
    };
  }
}
export function createMockProviders(): Omit<ProviderSet, 'tts'> & { stt: MockStt } {
  return { stt: new MockStt(), planner: new MockPlanner() };
}
