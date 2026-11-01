<script setup lang="ts">
import { computed } from 'vue';
import type { CharacterFrame } from './character.js';
import { characterCue } from './character-cues.js';
import './character-cues.css';
const props = defineProps<{ frame: CharacterFrame }>();
const cue = computed(() => characterCue(props.frame.interaction, props.frame.emotion));
const energy = computed(() =>
  props.frame.interaction === 'speaking' && Number.isFinite(props.frame.mouthOpen)
    ? Math.max(0, Math.min(1, props.frame.mouthOpen))
    : 0,
);
</script>
<template>
  <div
    class="character-cues"
    :data-cue="cue.kind"
    :data-emotion="frame.emotion"
    :style="{ '--cue-energy': energy }"
    aria-hidden="true"
  >
    <div class="character-emote-bubble">
      <span v-if="cue.kind === 'thinking'" class="character-thought-dots"><i /><i /><i /></span>
      <span v-else-if="cue.kind === 'speaking'" class="character-cue-voice"
        ><i /><i /><i /><i /><i
      /></span>
      <span v-else class="character-cue-symbol">{{ cue.symbol }}</span>
      <span class="character-cue-label">{{ cue.label }}</span>
    </div>
    <span v-if="cue.kind === 'listening'" class="character-listening-rays"><i /><i /><i /></span>
  </div>
</template>
