<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { CharacterFrame, CharacterRenderer } from './character.js';

const props = defineProps<{ frame: CharacterFrame; environment: string }>();
type RenderStatus = 'loading' | 'live2d' | 'failed' | 'suspended';
const emit = defineEmits<{ status: [status: RenderStatus] }>();
const canvas = ref<HTMLCanvasElement>();
const canvasKey = ref(0);
const posterUrl = '/assets/live2d/haru-poster.png';
const mode = ref<RenderStatus>('loading');
let renderer: CharacterRenderer | undefined;
let lifetime: AbortController | undefined;
let epoch = 0;
let disposed = false;

function setStatus(status: RenderStatus) {
  mode.value = status;
  emit('status', status);
}
function release() {
  // Invalidate ownership before an abort callback or late loader can touch the stage.
  epoch += 1;
  lifetime?.abort();
  lifetime = undefined;
  renderer?.dispose();
  renderer = undefined;
}
async function initialize() {
  release();
  if (disposed) return;
  if (document.hidden) {
    setStatus('suspended');
    return;
  }
  const owner = new AbortController();
  lifetime = owner;
  const ownEpoch = epoch;
  const ownsStage = () => !disposed && epoch === ownEpoch && !owner.signal.aborted;
  const failed = () => {
    if (!ownsStage()) return;
    release();
    setStatus('failed');
  };
  setStatus('loading');
  canvasKey.value += 1;
  try {
    // A destroyed WebGL renderer may lose its context; each load owns a fresh canvas.
    await nextTick();
    if (!ownsStage()) return;
    const target = canvas.value;
    if (!target) throw new Error('CHARACTER_CANVAS_UNAVAILABLE');
    const { loadLive2D } = await import('./live2d.js');
    if (!ownsStage()) return;
    const loaded = await loadLive2D(target, owner.signal, { onFailure: failed });
    if (!ownsStage()) {
      loaded.dispose();
      return;
    }
    renderer = loaded;
    renderer.update(props.frame);
    setStatus('live2d');
  } catch {
    failed();
  }
}
watch(
  () => props.frame,
  (frame, previous) => {
    if (
      frame.action === 'none' &&
      frame.mouthOpen === 0 &&
      (previous?.action !== 'none' || previous.mouthOpen !== 0)
    )
      renderer?.cancel();
    renderer?.update(frame);
  },
  { flush: 'sync' },
);
function visibility() {
  if (document.hidden) {
    release();
    setStatus('suspended');
  } else {
    void initialize();
  }
}
onMounted(() => {
  document.addEventListener('visibilitychange', visibility);
  void initialize();
});
onBeforeUnmount(() => {
  disposed = true;
  document.removeEventListener('visibilitychange', visibility);
  release();
});
</script>
<template>
  <div
    class="character-stage"
    :data-renderer="mode"
    :data-weather="environment"
    :data-interaction="frame.interaction"
    :data-emotion="frame.emotion"
  >
    <slot name="background" />
    <canvas
      :key="canvasKey"
      ref="canvas"
      class="live2d-canvas"
      :aria-hidden="mode !== 'live2d'"
      aria-label="Live2D 角色动画，Haru 官方技术替身"
    />
    <img
      v-if="mode === 'failed'"
      class="live2d-poster"
      :src="posterUrl"
      alt="Haru 样例角色静态画面，动画暂不可用"
    />
    <div class="scene-atmosphere" aria-hidden="true" />
    <div v-if="mode === 'loading'" class="character-notice" role="status">
      <span class="spinner" aria-hidden="true" />
      <span>加载角色</span>
    </div>
    <div v-else-if="mode === 'failed'" class="sr-only" role="status">
      <span class="notice-mark" aria-hidden="true">✦</span>
      <span>动画不可用，已显示静态角色画面。</span>
    </div>
    <div v-else-if="mode === 'suspended'" class="sr-only" role="status">动画已暂停</div>
  </div>
</template>
