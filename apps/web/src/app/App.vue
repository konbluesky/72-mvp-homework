<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ApiClient } from '../api/client.js';
import { ConnectionMonitor } from '../connection/monitor.js';
import ConnectionStatus from '../connection/ConnectionStatus.vue';
import { BrowserAudio } from '../playback/audio.js';
import { PlaybackScheduler } from '../playback/scheduler.js';
import { TurnController } from '../interaction/turn-controller.js';
import type { LegacySceneModule } from '../webgal/scenes/legacy-module.js';
import { PLATFORM_NAME } from './platform.js';
import CharacterStage from '../scene/CharacterStage.vue';
import { useSceneStore } from '../stores/scene.js';
import { useConversationDisplay, type DisplayLine } from './conversation-display.js';
import type { ReplySuggestion } from '@mira/protocol';
import { DraftSchema } from '../persistence/browser.js';
import { messageStatusText } from '../interaction/messages.js';
import '../interaction/messages.css';

const props = defineProps<{ content: LegacySceneModule }>();
const api = new ApiClient(undefined, undefined, 'conversation', {
  id: props.content.id,
  version: props.content.version,
});
const savedPreferences = api.persistence?.preferences();
const scene = useSceneStore();
const text = ref(api.persistence?.read('draft', DraftSchema) ?? '');
const selectedSuggestion = ref<ReplySuggestion>();
const input = ref<HTMLTextAreaElement>();
const info = ref<HTMLDialogElement>();
const history = ref<HTMLDialogElement>();
const menu = ref<HTMLDialogElement>();
const animationKey = ref(0);
const hold = ref<HTMLButtonElement>();
const inputMode = ref<'text' | 'voice'>(savedPreferences?.inputMode ?? 'text');
const inputFocused = ref(false);
const suggestionsExpanded = ref(savedPreferences?.suggestionsExpanded ?? true);
const conversation = useConversationDisplay(props.content.opening, api.persistence);
const { messages } = conversation;
const conversationViewport = ref<HTMLDivElement>();
const followConversation = ref(true);
let scrollEpoch = 0;
let disposed = false;
const visibleMessages = computed(() => {
  const grouped: DisplayLine[] = [];
  for (const line of messages.value) {
    const previous = grouped.at(-1);
    if (
      line.role === 'character' &&
      previous?.role === 'character' &&
      line.messageId === previous.messageId
    ) {
      previous.text += '\n' + line.text;
      previous.paused ||= line.paused;
    } else grouped.push({ ...line });
  }
  return grouped.slice(-6);
});
const latestReplyId = computed(
  () => visibleMessages.value.filter((line) => line.role === 'character').at(-1)?.id,
);
watch(
  [() => messages.value.at(-1)?.id, () => scene.interaction, () => scene.playback],
  async () => {
    const epoch = ++scrollEpoch;
    await nextTick();
    if (disposed || epoch !== scrollEpoch || !followConversation.value) return;
    const pane = conversationViewport.value;
    if (pane) pane.scrollTop = pane.scrollHeight;
  },
);
function onConversationScroll() {
  const pane = conversationViewport.value;
  if (pane) followConversation.value = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 32;
}
let controller: TurnController;
function timing(name: string, durationMs: number) {
  const measure = `character-interaction:${name}`;
  performance.clearMeasures(measure);
  performance.measure(measure, {
    start: Math.max(0, performance.now() - durationMs),
    duration: durationMs,
  });
}
const playback = new PlaybackScheduler({
  audio: new BrowserAudio((path, signal) => api.media(path, signal), timing),
  timing,
  presentation: props.content.createPresentation(scene),
  view: (value) => {
    conversation.observePlayback(value, scene.activeMessageId || undefined);
    scene.$patch(value);
    controller?.checkpointBrowser();
  },
  receipt: (value, turn) => controller.receipt(value, turn),
  expired: (turn) => controller.expire(turn),
  cancelled: (turn) => controller.expire(turn),
  started: (turn) => controller.replyStarted(turn),
  presented: (turn, success) => controller.replyCompleted(turn, success),
  failure: (message) => {
    scene.failure = message;
  },
});
controller = new TurnController(api, playback, scene);
watch(text, (value) => api.persistence?.write('draft', value), { flush: 'sync' });
watch(inputMode, (value) => api.persistence?.updatePreferences({ inputMode: value }), {
  flush: 'sync',
});
watch(
  suggestionsExpanded,
  (value) => api.persistence?.updatePreferences({ suggestionsExpanded: value }),
  { flush: 'sync' },
);
watch(
  () => scene.connected,
  (connected) => {
    if (connected && !scene.voiceInput) inputMode.value = 'text';
  },
);
const connectionMonitor = new ConnectionMonitor(api, {
  view: (value) => scene.$patch({ connection: value }),
  reachable: () => {
    void controller.recoverConnection();
  },
  unavailable: () => {
    conversation.pauseCaption();
    controller.connectionLost();
  },
});
function retryConnection() {
  if (document.hidden || !navigator.onLine) return;
  connectionMonitor.retry();
  void controller.recoverConnection(true, true);
}
const character = computed(() => ({
  interaction: scene.interaction,
  emotion: scene.emotion,
  action: scene.action,
  mouthOpen: scene.mouthOpen,
  photoInHand: scene.action === 'offerPhoto',
}));
const busy = computed(
  () =>
    scene.voicePreview === 'transcribing' ||
    scene.interaction === 'thinking' ||
    scene.interaction === 'speaking' ||
    scene.playback === 'buffering',
);
const activity = computed(() => {
  if (scene.connecting) return '连接中';
  if (!scene.connected) return '连接中断';
  if (scene.recording === 'permission') return '需要麦克风权限';
  if (scene.recording === 'recording') return '录音中';
  if (scene.voicePreview === 'transcribing') return '正在识别，完成后可编辑';
  if (scene.voicePreview === 'ready') return '语音草稿待确认';
  if (scene.playback === 'audio-error') return '音频未能播放';
  if (scene.interaction === 'thinking' || scene.playback === 'buffering') return '回复准备中';
  if (scene.interaction === 'speaking') return '语音播放中';
  return '';
});
const showSuggestions = computed(
  () =>
    scene.connected &&
    !scene.failure &&
    !busy.value &&
    scene.recording === 'idle' &&
    scene.voicePreview === 'idle' &&
    !text.value.trim() &&
    !inputFocused.value &&
    scene.suggestions.length > 0,
);
const suggestions = computed(() => scene.suggestions);
watch(
  () => scene.voicePreview,
  async (phase) => {
    if (phase !== 'ready') return;
    const epoch = ++editEpoch;
    text.value = scene.voiceDraft;
    inputMode.value = 'text';
    await nextTick();
    if (disposed || epoch !== editEpoch || scene.voicePreview !== 'ready') return;
    resizeInput();
    input.value?.focus();
  },
);
const composerHint = computed(() => {
  if (scene.recording === 'recording') return '上滑或按 Esc 取消 · 最长 15 秒';
  if (scene.recording === 'permission') return '请在浏览器中允许麦克风，松开可取消';
  return '';
});
watch(
  () => scene.transcribed,
  (value) => {
    if (value) {
      followConversation.value = true;
      conversation.addUser(value, scene.simulated ? 'sample' : 'voice');
    }
  },
);
watch(
  () => scene.voiceInput,
  (available) => {
    if (!available) inputMode.value = 'text';
  },
);
let editEpoch = 0;
let pointer: number | undefined;
let pressY = 0;
function send() {
  const value = text.value.trim();
  if (
    !value ||
    !scene.connected ||
    scene.recording !== 'idle' ||
    scene.voicePreview === 'transcribing'
  )
    return;
  const voice = scene.voicePreview === 'ready';
  const source =
    voice && scene.voiceDraftSimulated && value === scene.voiceDraft
      ? 'sample'
      : voice
        ? 'voice'
        : 'text';
  editEpoch += 1;
  conversation.pauseCaption();
  followConversation.value = true;
  const selected = selectedSuggestion.value;
  selectedSuggestion.value = undefined;
  let messageId: string | undefined;
  if (selected?.draft === value && selected.interaction?.kind === 'action') {
    const interaction = selected.interaction;
    if (
      interaction.revision === scene.story.revision &&
      scene.story.actions.some((action) => action.id === interaction.actionId)
    )
      messageId = controller.interact(interaction, true);
    else scene.failure = '这里的选择已更新，请重新选择。';
  } else messageId = controller.send(value);
  if (!messageId) return;
  conversation.addUser(value, source, messageId);
  text.value = '';
  inputFocused.value = false;
  if (input.value) {
    input.value.style.height = '';
    input.value.blur();
  }
}
function delivery(messageId?: string) {
  return scene.outgoing.find((message) => message.messageId === messageId);
}
function retryMessage(messageId: string) {
  followConversation.value = true;
  void controller.retry(messageId);
}
async function chooseSuggestion(suggestion: ReplySuggestion) {
  if (!showSuggestions.value || !scene.suggestions.includes(suggestion)) return;
  selectedSuggestion.value = suggestion;
  const epoch = ++editEpoch;
  inputMode.value = 'text';
  text.value = suggestion.draft;
  await nextTick();
  if (
    epoch === editEpoch &&
    scene.connected &&
    inputMode.value === 'text' &&
    text.value === suggestion.draft
  ) {
    resizeInput();
    input.value?.focus();
  }
}
function discardVoiceDraft() {
  editEpoch += 1;
  controller.discardVoicePreview();
  text.value = '';
  inputFocused.value = false;
  input.value?.blur();
}
function rerecord() {
  discardVoiceDraft();
  inputMode.value = 'voice';
}
function switchInputMode(mode: 'text' | 'voice') {
  if (scene.recording !== 'idle') return;
  if (scene.voicePreview !== 'idle') discardVoiceDraft();
  inputFocused.value = false;
  scene.voiceInputError = '';
  inputMode.value = mode;
}
function resizeInput() {
  const field = input.value;
  if (!field) return;
  field.style.height = 'auto';
  field.style.height = `${Math.max(28, Math.min(105, field.scrollHeight))}px`;
}
function interrupt() {
  conversation.pauseCaption();
  controller.interrupt();
}
function restart() {
  editEpoch += 1;
  cancel();
  api.persistence?.clearReading();
  conversation.reset();
  selectedSuggestion.value = undefined;
  followConversation.value = true;
  text.value = '';
  info.value?.close();
  menu.value?.close();
  history.value?.close();
  void controller.connect(true);
}
function startRecording() {
  editEpoch += 1;
  if (!scene.connected || !scene.voiceInput || scene.recording !== 'idle') return;
  conversation.pauseCaption();
  controller.press();
}
function down(event: PointerEvent) {
  if (event.button !== 0 || pointer !== undefined) return;
  event.preventDefault();
  pointer = event.pointerId;
  pressY = event.clientY;
  hold.value?.setPointerCapture(event.pointerId);
  startRecording();
}
function up(event: PointerEvent) {
  if (event.pointerId !== pointer) return;
  pointer = undefined;
  if (hold.value?.hasPointerCapture(event.pointerId))
    hold.value.releasePointerCapture(event.pointerId);
  controller.release();
}
function cancel() {
  pointer = undefined;
  if (scene.recording !== 'idle') conversation.pauseCaption();
  controller.cancelRecording();
}
function move(event: PointerEvent) {
  if (event.pointerId === pointer && pressY - event.clientY > 70) cancel();
}
function lostCapture() {
  const wasHeld = pointer !== undefined;
  pointer = undefined;
  // Automatic recording completion may replace the microphone with the draft editor.
  if (wasHeld && scene.recording !== 'idle') cancel();
}
function keyboardDown(event: KeyboardEvent) {
  if ([' ', 'Enter'].includes(event.key)) {
    event.preventDefault();
    if (!event.repeat) startRecording();
  }
}
function keyboardUp(event: KeyboardEvent) {
  if ([' ', 'Enter'].includes(event.key)) {
    event.preventDefault();
    controller.release();
  }
}
function submitKey(event: KeyboardEvent) {
  // Editing a transcript should not accidentally send it while the user inserts a new line.
  if (scene.voicePreview === 'ready' && !event.ctrlKey && !event.metaKey) return;
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send();
  }
}
function escape(event: KeyboardEvent) {
  if (event.key === 'Escape' && scene.voicePreview !== 'idle') {
    discardVoiceDraft();
    return;
  }
  if (event.key === 'Escape' && scene.recording !== 'idle') cancel();
}
function visibility() {
  if (document.hidden) {
    editEpoch += 1;
    conversation.pauseCaption();
    pointer = undefined;
    controller.interrupt('connection');
    void playback.dispose();
    connectionMonitor.suspend();
    controller.pauseRecovery();
  } else if (navigator.onLine) {
    connectionMonitor.start();
    void controller.recoverConnection(true, true);
  } else connectionMonitor.offline();
}
function blur() {
  if (scene.recording !== 'idle') cancel();
}
function offline() {
  connectionMonitor.offline();
}
function online() {
  if (!document.hidden) retryConnection();
}
function pagehide() {
  conversation.pauseCaption();
  controller.interrupt('connection');
}

onMounted(() => {
  if (navigator.onLine) {
    void controller.connect();
    if (!document.hidden) connectionMonitor.start();
  } else connectionMonitor.offline();
  document.addEventListener('visibilitychange', visibility);
  document.addEventListener('keydown', escape);
  window.addEventListener('blur', blur);
  window.addEventListener('offline', offline);
  window.addEventListener('online', online);
  window.addEventListener('pagehide', pagehide);
});
onBeforeUnmount(() => {
  disposed = true;
  scrollEpoch += 1;
  document.removeEventListener('visibilitychange', visibility);
  document.removeEventListener('keydown', escape);
  window.removeEventListener('blur', blur);
  window.removeEventListener('offline', offline);
  window.removeEventListener('online', online);
  window.removeEventListener('pagehide', pagehide);
  conversation.pauseCaption();
  connectionMonitor.dispose();
  void controller.dispose();
});
</script>
<template>
  <main
    class="experience"
    :data-state="scene.interaction"
    :data-emotion="scene.emotion"
    :data-action="scene.action"
    :data-weather="scene.environment"
    :data-playback="scene.playback"
  >
    <header class="scene-header">
      <a class="brand" href="/" :aria-label="`${PLATFORM_NAME}首页`"
        ><span class="brand-mark" aria-hidden="true">✳</span>{{ PLATFORM_NAME }}</a
      >
      <div class="header-connection">
        <ConnectionStatus
          :value="scene.connection"
          :session-connected="scene.connected"
          :session-connecting="scene.connecting"
          :session-expired="scene.sessionExpired"
          @retry="retryConnection"
          @restart="restart"
        />
      </div>
      <nav class="header-actions" aria-label="对话选项">
        <nav class="experience-switch" aria-label="页面版本切换">
          <span aria-current="page">原版对话</span>
          <a href="/webgal.html">WebGAL 故事</a>
        </nav>
        <button class="icon-button" aria-label="更多操作" @click="menu?.showModal()">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="5" cy="12" r="1" />
            <circle cx="12" cy="12" r="1" />
            <circle cx="19" cy="12" r="1" />
          </svg>
        </button>
      </nav>
    </header>
    <section class="portrait" :aria-label="`${content.title} · ${content.speaker}`">
      <CharacterStage
        :key="animationKey"
        :frame="character"
        :environment="scene.environment"
        @status="scene.animation = $event"
      >
        <template #background><component :is="content.backdrop" /></template>
      </CharacterStage>
      <div class="portrait-shade" aria-hidden="true" />
      <div class="character-identity">
        <h1>{{ content.speaker }}</h1>
        <span>{{ content.speakerDescription }}</span>
        <span
          v-if="scene.interaction === 'speaking'"
          class="voice-level"
          :style="{ '--voice-energy': scene.mouthOpen }"
          aria-hidden="true"
          ><i /><i /><i /><i
        /></span>
      </div>
      <div class="location">
        <span aria-hidden="true" class="location-line" /><span>{{ content.locationLabel }}</span
        ><span class="location-weather">{{ content.environmentLabel(scene.environment) }}</span>
      </div>
      <div v-if="scene.photo === 'loading'" class="photo-loading" role="status">
        <span class="spinner" />照片加载中
      </div>
      <section
        v-if="scene.photo === 'visible'"
        class="photo-view"
        :aria-label="content.photo.caption"
      >
        <div class="photo-card">
          <img data-photo :src="content.photo.url" :alt="content.photo.alt" />
          <p>{{ content.photo.caption }}</p>
        </div>
        <button aria-label="收起照片" @click="scene.photo = 'hidden'">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </section>
    </section>
    <section class="dialogue" :aria-label="`与 ${content.speaker} 对话`">
      <div
        ref="conversationViewport"
        class="conversation-body"
        aria-label="最近的对话"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        @scroll="onConversationScroll"
      >
        <article
          v-for="line in visibleMessages"
          :key="line.id"
          :class="line.role === 'user' ? 'recent-user' : 'character-message'"
          :aria-label="line.role === 'user' ? '你发送的消息' : `${content.speaker} 的回复`"
        >
          <button
            v-if="line.role === 'user' && delivery(line.messageId)?.status === 'failed'"
            class="message-retry"
            type="button"
            :disabled="
              !line.messageId || !controller.canRetry(line.messageId) || !!scene.retryingMessageId
            "
            :aria-label="`重试这条消息：${line.text}`"
            :title="delivery(line.messageId)?.error"
            @click="line.messageId && retryMessage(line.messageId)"
          >
            <span aria-hidden="true">!</span>
          </button>
          <span v-if="line.source === 'sample'" class="sample-label">语音示例</span>
          <p
            :class="{
              subtitle: line.role === 'character' && line.id === latestReplyId,
              'message-paused': line.paused,
            }"
          >
            {{ line.text }}
          </p>
          <small
            v-if="line.role === 'user' && messageStatusText(delivery(line.messageId))"
            class="message-status"
            :class="{ 'message-status-failed': delivery(line.messageId)?.status === 'failed' }"
            role="status"
            :title="delivery(line.messageId)?.error"
            >{{
              scene.retryingMessageId === line.messageId
                ? '正在重试…'
                : line.messageId && controller.canRetry(line.messageId)
                  ? '回复失败，点击重试'
                  : messageStatusText(delivery(line.messageId))
            }}</small
          >
        </article>
        <div
          v-if="busy && scene.interaction !== 'speaking'"
          class="reply-pending"
          aria-hidden="true"
        >
          <span class="reply-dots" aria-hidden="true"><i /><i /><i /></span>
        </div>
        <button v-if="scene.playback === 'text'" class="continue" @click="playback.continueText()">
          下一句 <span aria-hidden="true">→</span>
        </button>
      </div>
      <div class="interaction-area">
        <div v-if="scene.failure || scene.sessionExpired" class="recovery" role="alert">
          <p>{{ scene.failure || '会话已结束，请重新开始。' }}</p>
          <div class="recovery-actions">
            <template v-if="scene.sessionExpired">
              <button type="button" :disabled="scene.connecting" @click="restart">重新开始</button>
            </template>
            <template v-else-if="scene.playback === 'audio-error'"
              ><button
                @click="
                  scene.failure = '';
                  playback.useText();
                "
              >
                阅读文字</button
              ><button
                @click="
                  scene.failure = '';
                  playback.retryAudio();
                "
              >
                重试音频
              </button></template
            ><template v-else
              ><button :disabled="scene.connecting" @click="controller.connect()">重新连接</button
              ><button @click="scene.failure = ''">关闭提示</button></template
            >
          </div>
        </div>
        <div v-if="scene.animation === 'failed'" class="animation-note" role="status">
          <span>动画加载失败</span><button @click="animationKey++">重试</button>
        </div>
        <p v-if="scene.narration" class="scene-narration" role="status">{{ scene.narration }}</p>
        <div v-if="showSuggestions" class="suggestion-area">
          <button
            class="suggestion-heading"
            :aria-expanded="suggestionsExpanded"
            aria-controls="reply-options"
            @click="suggestionsExpanded = !suggestionsExpanded"
          >
            <span class="suggestion-spark" aria-hidden="true">✧</span>接一句<svg
              viewBox="0 0 20 20"
              aria-hidden="true"
              :class="{ collapsed: !suggestionsExpanded }"
            >
              <path d="m6 8 4 4 4-4" />
            </svg>
          </button>
          <div
            v-if="suggestionsExpanded"
            id="reply-options"
            class="suggestions"
            aria-label="推荐回复，选中后可编辑"
          >
            <button
              v-for="suggestion in suggestions"
              :key="suggestion.label"
              :title="'填入输入框：' + suggestion.draft"
              @click="chooseSuggestion(suggestion)"
            >
              {{ suggestion.label }}<span aria-hidden="true">↗</span>
            </button>
          </div>
        </div>
        <div v-if="scene.voiceInputError" class="voice-input-error" role="status">
          <p>{{ scene.voiceInputError }}</p>
          <div>
            <button type="button" @click="rerecord">重新录音</button
            ><button type="button" @click="switchInputMode('text')">改用文字</button>
          </div>
        </div>
        <div v-if="scene.voicePreview !== 'idle'" class="voice-preview-bar" role="status">
          <span>{{
            scene.voicePreview === 'transcribing'
              ? '正在识别，完成后可编辑…'
              : scene.voiceDraftSimulated
                ? '模拟识别草稿 · 可编辑后确认发送'
                : '语音草稿 · 可编辑后确认发送'
          }}</span>
          <div>
            <button v-if="scene.voicePreview === 'ready'" type="button" @click="rerecord">
              重新录音
            </button>
            <button type="button" @click="discardVoiceDraft">取消</button>
          </div>
        </div>
        <form
          class="composer"
          :class="{
            'composer-voice': inputMode === 'voice',
            recording: scene.recording === 'recording',
            responding: busy,
          }"
          @submit.prevent="send()"
        >
          <button
            v-if="inputMode === 'text'"
            type="button"
            class="input-switch"
            :disabled="!scene.voiceInput || !scene.connected"
            :aria-label="scene.voiceInput ? '切换语音输入' : '麦克风暂不可用，请输入文字'"
            :title="scene.voiceInput ? '语音输入' : '麦克风暂不可用'"
            @click="switchInputMode('voice')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5.5 10.5V12a6.5 6.5 0 0 0 13 0v-1.5M12 18.5V22M8.5 22h7" />
            </svg>
          </button>
          <button
            v-else
            type="button"
            class="input-switch"
            aria-label="切换文字输入"
            :disabled="scene.recording !== 'idle'"
            @click="switchInputMode('text')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="3" />
              <path d="M6.5 9h1M11.5 9h1M16.5 9h1M6.5 12.5h1M11.5 12.5h1M16.5 12.5h1M8 16h8" />
            </svg>
          </button>
          <template v-if="inputMode === 'text'"
            ><label class="sr-only" for="text-input">{{
              scene.voicePreview === 'ready' ? '编辑语音消息' : `给 ${content.speaker} 的消息`
            }}</label
            ><textarea
              id="text-input"
              ref="input"
              v-model="text"
              :disabled="!scene.connected || scene.voicePreview === 'transcribing'"
              maxlength="1000"
              rows="1"
              autocomplete="off"
              :placeholder="`给 ${content.speaker} 发消息…`"
              @focus="inputFocused = true"
              @blur="inputFocused = false"
              @input="resizeInput"
              @keydown="submitKey" /><button
              v-if="busy && !text.trim()"
              type="button"
              class="composer-stop"
              aria-label="停止当前回复"
              title="停止回复"
              @click="interrupt"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="8" y="8" width="8" height="8" rx="1.5" />
              </svg></button
            ><button
              v-else
              type="submit"
              class="send-button"
              :class="{ 'voice-confirm': scene.voicePreview === 'ready' }"
              :aria-label="scene.voicePreview === 'ready' ? '确认发送' : '发送文字'"
              :disabled="
                !scene.connected ||
                !text.trim() ||
                scene.recording !== 'idle' ||
                scene.voicePreview === 'transcribing'
              "
            >
              <span v-if="scene.voicePreview === 'ready'">确认发送</span>
              <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 19V5m-6 6 6-6 6 6" />
              </svg></button
          ></template>
          <button
            v-else
            ref="hold"
            type="button"
            class="hold-talk"
            :disabled="
              !scene.connected || !scene.voiceInput || scene.voicePreview === 'transcribing'
            "
            aria-label="按住录音，松开预览，上滑取消"
            @contextmenu.prevent.stop
            @pointerdown="down"
            @pointerup="up"
            @pointercancel="cancel"
            @pointermove="move"
            @lostpointercapture="lostCapture"
            @keydown="keyboardDown"
            @keyup="keyboardUp"
          >
            <span v-if="scene.recording === 'recording'" class="live-wave" aria-hidden="true"
              ><b /><b /><b /><b /><b /></span
            ><span>{{
              scene.recording === 'recording'
                ? '松开预览'
                : scene.recording === 'permission'
                  ? '等待麦克风授权'
                  : scene.voicePreview === 'transcribing'
                    ? '正在识别…'
                    : '按住录音'
            }}</span
            ><small v-if="scene.mode === 'mock' && scene.recording === 'idle'">示例</small>
          </button>
          <button
            v-if="inputMode === 'voice' && busy"
            type="button"
            class="composer-stop"
            aria-label="停止当前回复"
            title="停止回复"
            @click="interrupt"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="8" y="8" width="8" height="8" rx="1.5" />
            </svg>
          </button>
        </form>
        <p v-if="composerHint" class="interaction-hint">{{ composerHint }}</p>
        <p
          v-if="!scene.sessionExpired && (scene.connecting || !scene.connected)"
          class="connection-note"
          role="status"
        >
          {{ scene.connecting ? '正在恢复会话…' : '连接恢复后可继续发送消息。' }}
        </p>
        <span class="sr-only" role="status" aria-live="polite">{{ activity }}</span>
      </div>
    </section>
  </main>
  <dialog ref="menu" class="about action-menu" aria-labelledby="menu-title">
    <header class="sheet-header">
      <h2 id="menu-title">更多操作</h2>
      <button class="dialog-close" aria-label="关闭菜单" @click="menu?.close()">×</button>
    </header>
    <div class="menu-actions">
      <button
        @click="
          menu?.close();
          history?.showModal();
        "
      >
        对话回看 <span>查看本次聊天</span>
      </button>
      <button :disabled="scene.connecting" @click="restart">
        重新开始 <span>清空本次对话，从头开始</span>
      </button>
      <button
        @click="
          menu?.close();
          info?.showModal();
        "
      >
        场景与素材 <span>使用说明、角色来源</span>
      </button>
    </div>
    <p v-if="scene.mode === 'mock'" class="sheet-description">演示模式 · 本地回复与示例语音</p>
  </dialog>
  <dialog ref="history" class="history-sheet" aria-labelledby="history-title">
    <header class="sheet-header">
      <div>
        <span class="sheet-eyebrow">{{ content.speaker }}</span>
        <h2 id="history-title">本次对话</h2>
      </div>
      <button class="dialog-close" aria-label="关闭对话回看" @click="history?.close()">×</button>
    </header>
    <p class="sheet-description">最近 40 条已显示的文字，保存在当前浏览器。</p>
    <div class="history-lines">
      <article
        v-for="line in messages"
        :key="line.id"
        class="history-line"
        :class="{ 'history-user': line.role === 'user' }"
      >
        <div class="history-role">
          {{ line.role === 'character' ? content.speaker : '你'
          }}<small v-if="line.source === 'opening'">开场</small
          ><small v-else-if="line.source === 'sample'">示例转录</small
          ><small v-if="line.paused">已暂停</small>
        </div>
        <p>{{ line.text }}</p>
        <small v-if="line.role === 'user'" class="message-status">{{
          messageStatusText(delivery(line.messageId))
        }}</small>
      </article>
    </div>
    <p class="history-note">这里记录已显示的文字；语音可能在句中被打断。</p>
  </dialog>
  <dialog ref="info" class="about" aria-labelledby="about-title">
    <button class="dialog-close" aria-label="关闭场景说明" @click="info?.close()">×</button
    ><span class="sheet-eyebrow">{{ content.title }}</span>
    <h2 id="about-title">{{ content.about.title }}</h2>
    <p>{{ content.about.description }}</p>
    <p>
      直接发消息，或切换到麦克风按住录音。松开后可以预览、修改识别文字，确认后发送。回复播放时，可以暂停，也可以直接发出新消息。
    </p>
    <div class="about-details">
      <p>
        <b>当前模式</b
        >{{
          scene.mode === 'mock'
            ? '演示模式：本地回复与音频。录音采用示例转录，不是真实语音识别。'
            : scene.voiceInput
              ? '实时对话：支持文字、语音输入和语音回复。'
              : '实时对话：支持文字与语音回复，麦克风暂不可用。'
        }}
      </p>
      <p><b>角色素材</b>{{ content.about.attribution }}</p>
      <a class="asset-credits" href="/assets/live2d/NOTICE.md" target="_blank" rel="noreferrer"
        >素材与运行库来源 ↗</a
      >
      <a class="asset-credits" href="/webgal.html">切换到 WebGAL 故事 ↗</a>
    </div>
    <button class="restart-button" :disabled="scene.connecting" @click="restart">
      重新开始这段相遇 <span aria-hidden="true">↺</span>
    </button>
  </dialog>
</template>
