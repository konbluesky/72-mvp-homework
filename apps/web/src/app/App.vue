<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ApiClient } from '../api/client.js';
import { BrowserAudio } from '../playback/audio.js';
import { PlaybackScheduler } from '../playback/scheduler.js';
import { TurnController } from '../interaction/turn-controller.js';
import { createPresentation } from '../scene/presentation.js';
import CharacterStage from '../scene/CharacterStage.vue';
import { useSceneStore } from '../stores/scene.js';
import { useConversationDisplay } from './conversation-display.js';
import { replySuggestions, type ReplySuggestion } from './reply-suggestions.js';

const scene = useSceneStore();
const text = ref('');
const input = ref<HTMLTextAreaElement>();
const info = ref<HTMLDialogElement>();
const history = ref<HTMLDialogElement>();
const animationKey = ref(0);
const hold = ref<HTMLButtonElement>();
const inputMode = ref<'text' | 'voice'>('text');
const inputFocused = ref(false);
const suggestionsExpanded = ref(true);
const awaitingReply = ref(false);
const conversation = useConversationDisplay('雨这么大，先坐一会儿吧。');
const { messages, lastReply, lastUser, lastUserIsSample, replyPaused } = conversation;
const api = new ApiClient();
let controller: TurnController;
function timing(name: string, durationMs: number) {
  const measure = `mira:${name}`;
  performance.clearMeasures(measure);
  performance.measure(measure, {
    start: Math.max(0, performance.now() - durationMs),
    duration: durationMs,
  });
}
const playback = new PlaybackScheduler({
  audio: new BrowserAudio((path, signal) => api.media(path, signal), timing),
  timing,
  presentation: createPresentation(scene),
  view: (value) => {
    if (value.subtitle) awaitingReply.value = false;
    conversation.observePlayback(value);
    scene.$patch(value);
  },
  receipt: (value, turn) => controller.receipt(value, turn),
  expired: (turn) => controller.expire(turn),
  failure: (message) => {
    scene.failure = message;
  },
});
controller = new TurnController(api, playback, scene);
const character = computed(() => ({
  interaction: scene.interaction,
  emotion: scene.emotion,
  action: scene.action,
  mouthOpen: scene.mouthOpen,
  photoInHand: scene.action === 'offerPhoto',
}));
const busy = computed(
  () =>
    scene.interaction === 'thinking' ||
    scene.interaction === 'speaking' ||
    scene.playback === 'buffering',
);
const activity = computed(() => {
  if (scene.connecting) return '连接中';
  if (!scene.connected) return '连接中断';
  if (scene.recording === 'permission') return '需要麦克风权限';
  if (scene.recording === 'recording') return '录音中';
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
    inputMode.value === 'text' &&
    !text.value.trim() &&
    !inputFocused.value,
);
const suggestions = computed(() => replySuggestions(scene.facts, lastReply.value));
const composerHint = computed(() => {
  if (scene.recording === 'recording') return '上滑或按 Esc 取消 · 最长 15 秒';
  if (scene.recording === 'permission') return '请在浏览器中允许麦克风，松开可取消';
  if (scene.playback === 'text') return '当前使用文字继续这段对话';
  if (inputMode.value === 'voice' && scene.mode === 'mock') return '演示录音：发送后使用示例转录';
  if (inputMode.value === 'voice') return '按住录音，松开发送';
  return '';
});
watch(
  () => scene.transcribed,
  (value) => {
    if (value) conversation.addUser(value, scene.simulated ? 'sample' : 'voice');
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
  if (!value || !scene.connected || scene.recording !== 'idle') return;
  editEpoch += 1;
  conversation.pauseCaption();
  conversation.addUser(value);
  awaitingReply.value = true;
  text.value = '';
  inputFocused.value = false;
  if (input.value) {
    input.value.style.height = '';
    input.value.blur();
  }
  controller.send(value);
}
async function chooseSuggestion(suggestion: ReplySuggestion) {
  if (!showSuggestions.value) return;
  const epoch = ++editEpoch;
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
function resizeInput() {
  const field = input.value;
  if (!field) return;
  field.style.height = 'auto';
  field.style.height = `${Math.max(28, Math.min(105, field.scrollHeight))}px`;
}
function interrupt() {
  awaitingReply.value = false;
  conversation.pauseCaption();
  controller.interrupt();
}
function restart() {
  editEpoch += 1;
  cancel();
  conversation.reset();
  awaitingReply.value = false;
  text.value = '';
  info.value?.close();
  history.value?.close();
  void controller.connect(true);
}
function startRecording() {
  editEpoch += 1;
  if (!scene.connected || !scene.voiceInput || scene.recording !== 'idle') return;
  conversation.pauseCaption();
  awaitingReply.value = true;
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
  awaitingReply.value = false;
  pointer = undefined;
  if (scene.recording !== 'idle') conversation.pauseCaption();
  controller.cancelRecording();
}
function move(event: PointerEvent) {
  if (event.pointerId === pointer && pressY - event.clientY > 70) cancel();
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
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send();
  }
}
function escape(event: KeyboardEvent) {
  if (event.key === 'Escape' && scene.recording !== 'idle') cancel();
}
function visibility() {
  if (document.hidden) {
    editEpoch += 1;
    conversation.pauseCaption();
    cancel();
    void playback.dispose();
  }
}
function blur() {
  if (scene.recording !== 'idle') cancel();
}
function offline() {
  interrupt();
  scene.failure = '网络断开了。恢复连接后，可以接着聊。';
  scene.connected = false;
}
onMounted(() => {
  void controller.connect();
  document.addEventListener('visibilitychange', visibility);
  document.addEventListener('keydown', escape);
  window.addEventListener('blur', blur);
  window.addEventListener('offline', offline);
});
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', visibility);
  document.removeEventListener('keydown', escape);
  window.removeEventListener('blur', blur);
  window.removeEventListener('offline', offline);
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
      <a class="brand" href="/" aria-label="雨停之前首页"
        ><span class="brand-mark" aria-hidden="true">✳</span>雨停之前</a
      >
      <nav class="header-actions" aria-label="对话选项">
        <span v-if="scene.mode === 'mock'" class="mode-label">演示</span>
        <button
          class="quiet-button history-button"
          aria-label="回看本次对话"
          @click="history?.showModal()"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 5.5h16v11H8l-4 3z" />
            <path d="M8 9h8M8 12.5h5" /></svg
          ><span>回看</span>
        </button>
        <button
          class="icon-button"
          aria-label="更多：场景、使用说明与素材来源"
          @click="info?.showModal()"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="5" cy="12" r="1" />
            <circle cx="12" cy="12" r="1" />
            <circle cx="19" cy="12" r="1" />
          </svg>
        </button>
      </nav>
    </header>
    <section class="portrait" aria-label="雨夜咖啡馆里的 Mira">
      <CharacterStage
        :key="animationKey"
        :frame="character"
        :environment="scene.environment"
        @status="scene.animation = $event"
      />
      <div class="portrait-shade" aria-hidden="true" />
      <div class="location">
        <span aria-hidden="true" class="location-line" /><span>巷口咖啡馆</span
        ><span class="location-weather">{{
          scene.environment === 'rain-soft' ? '雨渐歇' : '深夜 · 有雨'
        }}</span>
      </div>
      <div v-if="scene.photo === 'loading'" class="photo-loading" role="status">
        <span class="spinner" />照片加载中
      </div>
      <section v-if="scene.photo === 'visible'" class="photo-view" aria-label="Mira 的旅行照片">
        <div class="photo-card">
          <img
            data-photo
            src="/assets/travel-photo.svg"
            alt="明亮天空下的海岸，蓝绿色海面与岸边的白色浪花"
          />
          <p>海边的一天</p>
        </div>
        <button aria-label="收起照片" @click="scene.photo = 'hidden'">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </section>
    </section>
    <section class="dialogue" aria-label="与 Mira 对话">
      <div class="conversation-body">
        <div v-if="lastUser" class="recent-user">
          <span>{{ lastUserIsSample ? '语音示例' : '你' }}</span>
          <p>{{ lastUser }}</p>
        </div>
        <div class="speaker">
          <h1>Mira<span class="speaker-period">.</span></h1>
          <span class="speaker-detail">旅行摄影师</span
          ><span
            v-if="scene.interaction === 'speaking'"
            class="voice-level"
            :style="{ '--voice-energy': scene.mouthOpen }"
            aria-hidden="true"
            ><i /><i /><i /><i
          /></span>
        </div>
        <div class="subtitle-space">
          <p
            v-if="!awaitingReply"
            class="subtitle"
            :class="{ 'subtitle-paused': replyPaused }"
            aria-live="polite"
          >
            {{ lastReply }}
          </p>
          <span
            v-if="scene.interaction === 'thinking' || scene.playback === 'buffering'"
            class="reply-dots"
            aria-hidden="true"
            ><i /><i /><i
          /></span>
        </div>
        <div class="reply-actions">
          <button v-if="busy" class="interrupt" @click="interrupt">
            <span class="stop-square" aria-hidden="true" />{{
              scene.interaction === 'speaking' ? '暂停，换我说' : '取消这次回复'
            }}</button
          ><span v-else-if="replyPaused" class="paused-note">这句已暂停</span
          ><button
            v-if="scene.playback === 'text'"
            class="continue"
            @click="playback.continueText()"
          >
            下一句 <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
      <div class="interaction-area">
        <div v-if="scene.failure" class="recovery" role="alert">
          <p>{{ scene.failure }}</p>
          <div class="recovery-actions">
            <template v-if="scene.playback === 'audio-error'"
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
        <form
          class="composer"
          :class="{
            'composer-voice': inputMode === 'voice',
            recording: scene.recording === 'recording',
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
            @click="inputMode = 'voice'"
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
            @click="inputMode = 'text'"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="3" />
              <path d="M6.5 9h1M11.5 9h1M16.5 9h1M6.5 12.5h1M11.5 12.5h1M16.5 12.5h1M8 16h8" />
            </svg>
          </button>
          <template v-if="inputMode === 'text'"
            ><label class="sr-only" for="text-input">给 Mira 的消息</label
            ><textarea
              id="text-input"
              ref="input"
              v-model="text"
              :disabled="!scene.connected"
              maxlength="1000"
              rows="1"
              autocomplete="off"
              placeholder="给 Mira 发消息…"
              @focus="inputFocused = true"
              @blur="inputFocused = false"
              @input="resizeInput"
              @keydown="submitKey" /><button
              type="submit"
              class="send-button"
              aria-label="发送文字"
              :disabled="!scene.connected || !text.trim() || scene.recording !== 'idle'"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 19V5m-6 6 6-6 6 6" />
              </svg></button
          ></template>
          <button
            v-else
            ref="hold"
            type="button"
            class="hold-talk"
            :disabled="!scene.connected || !scene.voiceInput"
            aria-label="按住录音，松开发送，上滑取消"
            @pointerdown="down"
            @pointerup="up"
            @pointercancel="cancel"
            @pointermove="move"
            @lostpointercapture="pointer !== undefined && cancel()"
            @keydown="keyboardDown"
            @keyup="keyboardUp"
          >
            <span v-if="scene.recording === 'recording'" class="live-wave" aria-hidden="true"
              ><b /><b /><b /><b /><b /></span
            ><span>{{
              scene.recording === 'recording'
                ? '松开发送'
                : scene.recording === 'permission'
                  ? '等待麦克风授权'
                  : '按住录音'
            }}</span
            ><small v-if="scene.mode === 'mock' && scene.recording === 'idle'">示例</small>
          </button>
        </form>
        <p v-if="composerHint" class="interaction-hint">{{ composerHint }}</p>
        <p v-if="scene.connecting || !scene.connected" class="connection-note" role="status">
          {{ scene.connecting ? '正在建立连接…' : '暂时离线，重新连接后可发送消息。' }}
        </p>
        <span class="sr-only" role="status" aria-live="polite">{{ activity }}</span>
      </div>
    </section>
  </main>
  <dialog ref="history" class="history-sheet" aria-labelledby="history-title">
    <header class="sheet-header">
      <div>
        <span class="sheet-eyebrow">MIRA</span>
        <h2 id="history-title">本次对话</h2>
      </div>
      <button class="dialog-close" aria-label="关闭对话回看" @click="history?.close()">×</button>
    </header>
    <p class="sheet-description">最近 40 条页面文字，仅保留在当前页面。</p>
    <div class="history-lines">
      <article
        v-for="line in messages"
        :key="line.id"
        class="history-line"
        :class="{ 'history-user': line.role === 'user' }"
      >
        <div class="history-role">
          {{ line.role === 'character' ? 'Mira' : '你'
          }}<small v-if="line.source === 'opening'">开场</small
          ><small v-else-if="line.source === 'sample'">示例转录</small
          ><small v-if="line.paused">已暂停</small>
        </div>
        <p>{{ line.text }}</p>
      </article>
    </div>
    <p class="history-note">这里记录已显示的文字；语音可能在句中被打断。</p>
  </dialog>
  <dialog ref="info" class="about" aria-labelledby="about-title">
    <button class="dialog-close" aria-label="关闭场景说明" @click="info?.close()">×</button
    ><span class="sheet-eyebrow">雨停之前</span>
    <h2 id="about-title">一场雨，一次偶遇。</h2>
    <p>深夜的咖啡馆快打烊了。Mira 把相机放在桌边，面前的咖啡已经凉了一半。</p>
    <p>直接发消息，或切换到麦克风按住录音。回复播放时，可以暂停，也可以直接发出新消息。</p>
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
      <p>
        <b>角色素材</b>Haru 为 Live2D 官方样例，作为原创成年角色 Mira
        的表演替身。当前照片为独立场景道具，样例不含专用递照片动作。
      </p>
      <a class="asset-credits" href="/assets/live2d/NOTICE.md" target="_blank" rel="noreferrer"
        >素材与运行库来源 ↗</a
      >
    </div>
    <button class="restart-button" :disabled="scene.connecting" @click="restart">
      重新开始这段相遇 <span aria-hidden="true">↺</span>
    </button>
  </dialog>
</template>
