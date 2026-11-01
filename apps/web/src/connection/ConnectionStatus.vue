<script setup lang="ts">
import { computed } from 'vue';
import type { ConnectionView } from './monitor.js';
const props = defineProps<{
  value: ConnectionView;
  sessionConnected: boolean;
  sessionConnecting: boolean;
  sessionExpired: boolean;
}>();
const emit = defineEmits<{ retry: []; restart: [] }>();
const serviceLabel = computed(
  () =>
    ({
      connecting: '检测中',
      connected: '已连接',
      degraded: '连接不稳',
      reconnecting: '重连中',
      offline: '未连接',
      suspended: '检测已暂停',
    })[props.value.state],
);
const label = computed(() => {
  if (props.sessionExpired) return '会话已结束';
  if (props.value.state === 'connected' && !props.sessionConnected)
    return props.sessionConnecting ? '连接会话' : '会话未连接';
  return serviceLabel.value;
});
const tone = computed(() =>
  props.sessionExpired || (!props.sessionConnected && props.value.state === 'connected')
    ? 'degraded'
    : props.value.state,
);
const time = computed(() =>
  props.value.lastProbeAt === null
    ? '尚未收到响应'
    : new Date(props.value.lastProbeAt).toLocaleTimeString('zh-CN', { hour12: false }),
);
</script>
<template>
  <details class="connection-status" :data-state="tone">
    <summary
      :aria-label="`服务连接：${label}${value.latencyMs === null ? '' : `，HTTP 往返 ${value.latencyMs} 毫秒`}`"
    >
      <span class="connection-dot" aria-hidden="true" />
      <span>{{ label }}</span
      ><span class="connection-latency">{{
        value.latencyMs === null ? '--' : `${value.latencyMs} ms`
      }}</span>
    </summary>
    <section class="connection-popover" aria-label="连接详情">
      <h2>连接详情</h2>
      <dl>
        <div>
          <dt>SSE 通道</dt>
          <dd>{{ value.streamConnected ? '已连接' : serviceLabel }}</dd>
        </div>
        <div>
          <dt>当前会话</dt>
          <dd>
            {{
              sessionExpired
                ? '已过期'
                : sessionConnected
                  ? '可用'
                  : sessionConnecting
                    ? '正在恢复'
                    : '未连接'
            }}
          </dd>
        </div>
        <div>
          <dt>HTTP 往返</dt>
          <dd>{{ value.latencyMs === null ? '--' : `${value.latencyMs} ms` }}</dd>
        </div>
        <div>
          <dt>最近探测成功</dt>
          <dd>{{ time }}</dd>
        </div>
        <div v-if="value.reconnectAttempt">
          <dt>通道重试</dt>
          <dd>第 {{ value.reconnectAttempt }} 次</dd>
        </div>
      </dl>
      <p v-if="value.lastError" class="connection-last-error">{{ value.lastError }}</p>
      <p>
        延时为浏览器到服务端的 HTTP 往返采样，不含模型响应时间。连接恢复不会重发消息或重播回复。
      </p>
      <button v-if="sessionExpired" type="button" @click="emit('restart')">重新开始会话</button>
      <button v-else type="button" :disabled="sessionConnecting" @click="emit('retry')">
        立即重连
      </button>
    </section>
  </details>
</template>
<style scoped>
.connection-status {
  position: relative;
  color: #adbcad;
  font-size: 10px;
}
summary {
  list-style: none;
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  cursor: pointer;
  white-space: nowrap;
}
summary::-webkit-details-marker {
  display: none;
}
summary:focus-visible {
  outline: 2px solid #d5c69e;
  outline-offset: 3px;
  border-radius: 5px;
}
.connection-dot {
  width: 5px;
  height: 5px;
  background: #8d9d8c;
  border-radius: 50%;
}
[data-state='connected'] .connection-dot {
  background: #a9c68c;
}
[data-state='degraded'] .connection-dot,
[data-state='reconnecting'] .connection-dot {
  background: #d4b47e;
}
[data-state='offline'] .connection-dot {
  background: #cd9b8f;
}
.connection-latency {
  color: #94a78f;
  font-variant-numeric: tabular-nums;
}
.connection-popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 285px;
  max-width: calc(100vw - 32px);
  padding: 20px;
  border: 1px solid #a9bc9e40;
  border-radius: 12px;
  background: #142324f5;
  box-shadow: 0 18px 50px #0005;
  z-index: 20;
  white-space: normal;
}
h2 {
  font-size: 13px;
  font-weight: 500;
  color: #e0e7d6;
  margin: 0 0 16px;
}
dl {
  margin: 0;
}
dl div {
  display: flex;
  justify-content: space-between;
  gap: 15px;
  margin: 12px 0;
}
dt {
  color: #91a58e;
}
dd {
  margin: 0;
  color: #d2dcc7;
}
p {
  font-size: 10px;
  line-height: 1.8;
  color: #8d9f89;
  margin: 16px 0 10px;
}
button {
  width: 100%;
  min-height: 40px;
  border: 1px solid #b9c3a64f;
  border-radius: 7px;
  background: #b7c59e0e;
  color: #d3dfc5;
  font-size: 11px;
}
@media (max-width: 760px) {
  .connection-status {
    font-size: 9px;
  }
  summary {
    gap: 4px;
  }
  .connection-popover {
    position: fixed;
    top: 65px;
    right: 16px;
  }
}
</style>
