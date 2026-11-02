import { nextTick } from 'vue';
import { projectStory } from '@mira/protocol';
import type { PresentationPort } from '../../../playback/scheduler.js';
import type { SceneStore } from '../../../stores/scene.js';

function frame(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      cancelAnimationFrame(id);
      reject(signal.reason);
    };
    const id = requestAnimationFrame(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    });
    signal.addEventListener('abort', abort, { once: true });
  });
}
async function painted(signal: AbortSignal): Promise<void> {
  await nextTick();
  await frame(signal);
  await frame(signal);
  signal.throwIfAborted();
  if (document.hidden) throw new Error('PAGE_HIDDEN');
}
export function createPresentation(store: SceneStore): PresentationPort {
  let pendingEnvironment: { previous: string; next: string } | undefined;
  return {
    async photo(_event, signal) {
      signal.throwIfAborted();
      throw new Error('SCENE_PHOTO_NOT_AVAILABLE');
    },
    async environment(event, signal) {
      signal.throwIfAborted();
      const pending = { previous: store.environment, next: event.environment };
      pendingEnvironment = pending;
      store.environment = event.environment;
      try {
        await painted(signal);
        if (pendingEnvironment === pending) pendingEnvironment = undefined;
      } catch (error) {
        if (pendingEnvironment === pending) {
          store.environment = pending.previous;
          pendingEnvironment = undefined;
        }
        throw error;
      }
    },
    async execute(event, signal) {
      if (event.type !== 'beat') throw new Error('STORY_STAGE_REQUIRED');
      await painted(signal);
      store.story = projectStory(store.story, event);
    },
    clear() {
      store.photo = 'hidden';
      if (pendingEnvironment) {
        store.environment = pendingEnvironment.previous;
        pendingEnvironment = undefined;
      }
    },
  };
}
