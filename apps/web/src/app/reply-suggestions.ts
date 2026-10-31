import type { Facts } from '@mira/protocol';

export interface ReplySuggestion {
  label: string;
  draft: string;
}

/** Curated conversation starters, not generated replies or executable scene instructions. */
export function replySuggestions(facts: Facts, displayedReply: string): ReplySuggestion[] {
  if (facts.rain_softened)
    return [
      { label: '聊聊下一站', draft: '雨小了，你接下来打算去哪儿？' },
      { label: '再坐一会儿', draft: '不急的话，我们再坐一会儿吧。' },
    ];
  if (facts.photo_revealed)
    return [
      { label: '问问拍摄地点', draft: '照片里的海边在哪里？' },
      { label: '聊聊那一天', draft: '拍下这张照片的时候，你在想什么？' },
    ];
  if (/等|约|朋友/.test(displayedReply))
    return [
      { label: '问问她在等谁', draft: '你在等的人，对你来说很重要吗？' },
      { label: '换个轻松的话题', draft: '聊聊你的旅行吧，最近去过哪里？' },
    ];
  return [
    { label: '聊聊那台相机', draft: '相机里有没有一张你最舍不得删的照片？' },
    { label: '问问她为什么留下', draft: '你怎么这么晚还在咖啡馆？' },
  ];
}
