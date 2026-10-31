import { readFile } from 'node:fs/promises';
import { photoRequested } from '../scenario/rules.js';
import type { PlanSegment, ReplyPlan } from '@mira/protocol';
import {
  ProviderError,
  type ProviderSet,
  type SpeechToTextProvider,
  type ReplyPlanner,
  type TextToSpeechProvider,
  type AudioData,
  type PlanInput,
} from './types.js';

export const MOCK_LINES = {
  hello: '雨还在下。你也想在这里躲一会儿吗？',
  helloNext: '我叫米拉。窗边的位置，留给你。',
  waiting: '我在等一个很久没见的人。也许，她今天不会来了。',
  travel: '你也喜欢旅行吗？我一直记得海边的那阵风。',
  comfort: '谢谢你。有人愿意陪我坐一会儿，已经很好了。',
  photo: '可以。这是我们在海边留下的照片，你看，天空很亮。',
  rain: '雨好像小了一点。今晚，也没有刚才那么冷了。',
  refuse: '好，我们不看照片。就听一会儿雨声吧。',
  after: '刚才那张照片，让我想起了很多温暖的事。',
} as const;
export const MOCK_TRANSCRIPT = '能看看照片吗？';

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
      segments: [
        segment(MOCK_LINES.photo, 'relieved', 'offerPhoto', [
          { type: 'photo', resourceId: 'travel_photo_01' },
        ]),
        segment(MOCK_LINES.rain, 'relieved', 'lookWindow', [
          { type: 'environment', environment: 'rain-soft' },
        ]),
      ],
    };
  if (/(等谁|等什么|在等|为什么|伤心)/.test(text))
    return { segments: [segment(MOCK_LINES.waiting, 'guarded', 'lookWindow')] };
  if (/(旅行|海边|风景|远方)/.test(text))
    return { segments: [segment(MOCK_LINES.travel, 'curious', 'lookWindow')] };
  if (/(陪|没关系|谢谢|别难过|安慰|会好的)/.test(text))
    return { segments: [segment(MOCK_LINES.comfort, 'relieved')] };
  if (/(雨|天气)/.test(text))
    return {
      segments: [
        segment(
          facts.includes('photo_revealed') ? MOCK_LINES.rain : MOCK_LINES.hello,
          'curious',
          'lookWindow',
          facts.includes('photo_revealed')
            ? [{ type: 'environment', environment: 'rain-soft' }]
            : [],
        ),
      ],
    };
  if (facts.includes('photo_revealed'))
    return { segments: [segment(MOCK_LINES.after, 'relieved')] };
  return {
    segments: [segment(MOCK_LINES.hello, 'curious'), segment(MOCK_LINES.helloNext, 'curious')],
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
        { label: '聊聊旅行', draft: '旅行中有没有让你舍不得离开的地方？' },
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
        { label: '聊聊那次旅行', draft: '那次海边的旅行，最让你难忘的是什么？' },
        { label: '问问下一站', draft: '以后你还想去什么地方拍照？' },
      ],
    };
  return {
    ...content,
    suggestions: [
      { label: '聊聊摄影', draft: '你是什么时候开始喜欢摄影的？' },
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
    return mockPlan(input.text, input.facts);
  }
}
export class MockTts implements TextToSpeechProvider {
  readonly info = { provider: 'mock', model: 'espeak-ng-cmn-fixtures' };
  async synthesize(text: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const name = Object.entries(MOCK_LINES).find(([, value]) => value === text)?.[0];
    if (!name) throw new ProviderError('INVALID_AUDIO');
    const bytes = await readFile(
      new URL(`../../../../assets/mock-audio/${name}.wav`, import.meta.url),
      { signal },
    );
    signal.throwIfAborted();
    return { bytes, mimeType: 'audio/wav' };
  }
}
export function createMockProviders(): ProviderSet & { stt: MockStt } {
  return { stt: new MockStt(), planner: new MockPlanner(), tts: new MockTts() };
}
