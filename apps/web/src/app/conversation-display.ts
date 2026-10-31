import { ref } from 'vue';
import type { PlaybackView } from '../playback/scheduler.js';

export interface DisplayLine {
  id: number;
  role: 'user' | 'character';
  text: string;
  source: 'opening' | 'text' | 'voice' | 'sample' | 'playback';
  paused: boolean;
}

/** A bounded, page-local reading view. Never sends receipts or writes session facts. */
export function useConversationDisplay(opening: string) {
  let sequence = 0;
  let activeCaption: number | undefined;
  const messages = ref<DisplayLine[]>([]);
  const lastReply = ref(opening);
  const lastUser = ref('');
  const lastUserIsSample = ref(false);
  const replyPaused = ref(false);

  function append(line: Omit<DisplayLine, 'id'>) {
    const id = ++sequence;
    messages.value = [...messages.value.slice(-39), { ...line, id }];
    return id;
  }
  function addUser(value: string, source: 'text' | 'voice' | 'sample' = 'text') {
    lastUser.value = value;
    lastUserIsSample.value = source === 'sample';
    append({ role: 'user', text: value, source, paused: false });
  }
  function observePlayback(value: Partial<PlaybackView>) {
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
  reset();
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
