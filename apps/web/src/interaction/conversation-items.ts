import type { ImageShare } from '@mira/protocol';
export interface ImageShareItem {
  kind: 'image-share';
  shareId: string;
  anchorId: string;
}
export interface ImageShareView extends ImageShare {
  display: 'placeholder' | 'loading' | 'presented' | 'load_failed';
  cancelRequested?: boolean;
  collapsed: boolean;
  url?: string;
  networkError: boolean;
  operation: boolean;
}
/** Versions and terminal decisions are shared by both renderers; entries only carry references. */
export function mergeImageShare(
  previous: ImageShareView | undefined,
  next: ImageShare,
): ImageShareView | undefined {
  if (
    previous &&
    (next.version < previous.version ||
      (['cancelled', 'expired'].includes(previous.phase) && next.phase !== previous.phase))
  )
    return previous;
  return {
    ...next,
    display: previous?.display ?? 'placeholder',
    collapsed: previous?.collapsed ?? false,
    url: previous?.url,
    networkError: false,
    operation: previous?.operation ?? false,
    cancelRequested: previous?.cancelRequested ?? false,
  };
}
export function imageStatus(view: ImageShareView): string {
  if (view.cancelRequested && view.phase !== 'cancelled')
    return view.networkError ? '取消尚未确认，连接恢复后继续确认' : '正在取消这张照片';
  if (view.networkError) return '连接恢复后继续确认照片进度';
  if (view.phase === 'cancelled') return '这次先不留照片了';
  if (view.phase === 'expired') return '这次照片准备已结束';
  if (view.display === 'load_failed') return '照片已准备好，暂时没加载出来';
  if (view.display === 'loading') return '正在展开照片';
  switch (view.phase) {
    case 'preparing':
      return view.longWait ? '这张还在准备，可以先继续聊' : '正在准备，可以继续聊天';
    case 'submit_unknown':
      return '正在确认照片进度，可以继续聊';
    case 'ready':
      return '已准备好，空闲时给你看';
    case 'presented':
      return '已分享';
    case 'failed':
      return '这张暂时没准备好';
  }
}

/** Retain the single media anchor even when ordinary reading history is truncated. */
export function retainReading<T extends { shareId?: string }>(entries: T[], limit = 60): T[] {
  const media = entries.filter((entry) => entry.shareId).slice(-1);
  const selected = new Set([
    ...entries.filter((entry) => !entry.shareId).slice(-(limit - media.length)),
    ...media,
  ]);
  return entries.filter((entry) => selected.has(entry));
}
