<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import type { ImageShareView } from '../interaction/conversation-items.js';
import { imageStatus } from '../interaction/conversation-items.js';
import type { MediaShareCoordinator } from '../interaction/media-share-coordinator.js';
import './cards.css';
const props = defineProps<{
  share: ImageShareView;
  coordinator: MediaShareCoordinator;
  history?: boolean;
}>();
const node = ref<HTMLElement>();
const large = ref<HTMLDialogElement>();
onMounted(() => props.coordinator.register(props.share.shareId, node.value ?? null));
onBeforeUnmount(() => props.coordinator.register(props.share.shareId, null, node.value));
watch(
  () => [props.share.presentedAt, props.share.assetId],
  () => {
    if (props.share.presentedAt && !props.share.url && props.share.display !== 'load_failed')
      void props.coordinator.restore(props.share);
  },
  { immediate: true },
);
function view(event: Event) {
  (event.currentTarget as HTMLButtonElement).blur();
  void props.coordinator.view(props.share.shareId);
}
function enlarge() {
  props.coordinator.gate({ modal: true });
  large.value?.showModal();
}
</script>
<template>
  <article
    ref="node"
    class="image-share-card"
    :class="{ 'is-collapsed': share.collapsed }"
    :data-share-id="share.shareId"
    :aria-label="share.title"
  >
    <header>
      <strong>{{ share.title }}{{ share.simulated ? ' · 模拟' : '' }}</strong
      ><button
        type="button"
        :aria-expanded="!share.collapsed"
        @click="coordinator.collapse(share.shareId)"
      >
        {{ share.collapsed ? '展开' : '收起' }}
      </button>
    </header>
    <div v-if="!share.collapsed" class="image-share-preview">
      <button
        v-if="
          share.url &&
          share.display === 'presented' &&
          !['cancelled', 'expired'].includes(share.phase)
        "
        type="button"
        class="image-share-enlarge"
        aria-label="放大照片"
        @click="enlarge"
      >
        <img
          :src="share.url"
          :alt="share.originLabel + (share.simulated ? '（模拟场景图）' : '')"
        />
      </button>
      <span v-else aria-hidden="true">{{ share.phase === 'failed' ? '暂未完成' : '纪念照' }}</span>
    </div>
    <p role="status" :aria-live="history ? 'off' : 'polite'">{{ imageStatus(share) }}</p>
    <small>{{ share.originLabel }}</small>
    <div class="image-share-actions">
      <button
        v-if="
          (share.phase === 'ready' || share.display === 'load_failed') &&
          !['cancelled', 'expired'].includes(share.phase)
        "
        type="button"
        :disabled="share.operation"
        @click="view"
      >
        {{ share.display === 'load_failed' ? '重新加载' : '查看' }}
      </button>
      <button
        v-if="share.canRetryGeneration"
        type="button"
        :disabled="share.operation"
        @click="coordinator.retry(share.shareId)"
      >
        重新准备一次
      </button>
      <button
        v-if="!['cancelled', 'expired', 'presented'].includes(share.phase)"
        type="button"
        :disabled="share.operation"
        @click="coordinator.cancel(share.shareId)"
      >
        取消这张
      </button>
    </div>
    <dialog ref="large" class="image-share-lightbox" @close="coordinator.gate({ modal: false })">
      <button type="button" autofocus @click="large?.close()">关闭大图</button
      ><img v-if="share.url" :src="share.url" :alt="share.originLabel" />
    </dialog>
  </article>
</template>
