import { ref } from 'vue';
import type { PlaybackView } from '../playback/scheduler.js';
import { ReadingHistorySchema, type BrowserPersistence } from '../persistence/browser.js';

export interface DisplayLine {
  id: number;
  role: 'user' | 'character';
  text: string;
  source: 'opening' | 'text' | 'voice' | 'sample' | 'playback';
  paused: boolean;
  messageId?: string;
}

/** A bounded reading view. Never sends receipts or writes session facts. */
export function useConversationDisplay(opening: string, persistence?: BrowserPersistence) {
  let sequence = 0;
  let activeCaption: number | undefined;
  const messages = ref<DisplayLine[]>([]);
  const lastReply = ref(opening);
  const lastUser = ref('');
  const lastUserIsSample = ref(false);
  const replyPaused = ref(false);

  function save() {
    persistence?.write(
      'history',
      messages.value.map((line) => ({
        id: line.id,
        kind: line.source === 'opening' ? 'opening' : line.role === 'user' ? 'user' : 'speech',
        text: line.text,
        source: line.source,
        paused: line.paused,
        ...(line.messageId ? { messageId: line.messageId } : {}),
      })),
    );
  }

  function append(line: Omit<DisplayLine, 'id'>) {
    const id = ++sequence;
    messages.value = [...messages.value.slice(-39), { ...line, id }];
    save();
    return id;
  }
  function addUser(
    value: string,
    source: 'text' | 'voice' | 'sample' = 'text',
    messageId?: string,
  ) {
    lastUser.value = value;
    lastUserIsSample.value = source === 'sample';
    append({
      role: 'user',
      text: value,
      source,
      paused: false,
      ...(messageId ? { messageId } : {}),
    });
  }
  function observePlayback(value: Partial<PlaybackView>, messageId?: string) {
    // Only text already issued by the qualified playback scheduler enters this view.
    if (value.subtitle === undefined) return;
    if (!value.subtitle) {
      activeCaption = undefined;
      return;
    }
    const previous = messages.value.find((line) => line.id === activeCaption);
    if (!previous || previous.text !== value.subtitle) {
      activeCaption = append({
        role: 'character',
        text: value.subtitle,
        source: 'playback',
        paused: false,
        ...(messageId ? { messageId } : {}),
      });
    }
    lastReply.value = value.subtitle;
    replyPaused.value = false;
  }
  function pauseCaption() {
    if (activeCaption === undefined) return;
    const line = messages.value.find((entry) => entry.id === activeCaption);
    if (line) line.paused = true;
    replyPaused.value = true;
    save();
  }
  function reset() {
    activeCaption = undefined;
    messages.value = [];
    lastReply.value = opening;
    lastUser.value = '';
    lastUserIsSample.value = false;
    replyPaused.value = false;
    append({ role: 'character', text: opening, source: 'opening', paused: false });
  }
  const saved = persistence?.read('history', ReadingHistorySchema);
  if (saved?.length) {
    messages.value = saved
      .filter((line) => line.kind !== 'narration')
      .slice(-40)
      .map((line) => ({
        id: line.id,
        role: line.kind === 'user' ? 'user' : 'character',
        text: line.text,
        source:
          line.source ??
          (line.kind === 'opening' ? 'opening' : line.kind === 'user' ? 'text' : 'playback'),
        paused: line.paused,
        ...(line.messageId ? { messageId: line.messageId } : {}),
      }));
    sequence = Math.max(0, ...messages.value.map((line) => line.id));
    const character = messages.value.filter((line) => line.role === 'character').at(-1);
    const user = messages.value.filter((line) => line.role === 'user').at(-1);
    lastReply.value = character?.text ?? opening;
    replyPaused.value = character?.paused ?? false;
    lastUser.value = user?.text ?? '';
    lastUserIsSample.value = user?.source === 'sample';
  } else reset();
  return {
    messages,
    lastReply,
    lastUser,
    lastUserIsSample,
    replyPaused,
    addUser,
    observePlayback,
    pauseCaption,
    reset,
  };
}
