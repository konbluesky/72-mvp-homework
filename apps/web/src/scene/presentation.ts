import { nextTick } from 'vue';
import type { PresentationPort } from '../playback/scheduler.js';
import type { SceneStore } from '../stores/scene.js';
import { abortable } from '../playback/abortable.js';

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
  let pendingEnvironment: { previous: 'rain' | 'rain-soft'; next: 'rain-soft' } | undefined;
  return {
    async photo(_event, ownerSignal) {
      const signal = AbortSignal.any([ownerSignal, AbortSignal.timeout(8_000)]);
      store.photo = 'loading';
      const image = new Image();
      try {
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            image.onload = null;
            image.onerror = null;
            signal.removeEventListener('abort', abort);
          };
          const abort = () => {
            cleanup();
            image.src = '';
            reject(signal.reason);
          };
          signal.addEventListener('abort', abort, { once: true });
          image.onerror = () => {
            cleanup();
            reject(new Error('PHOTO_FAILED'));
          };
          image.onload = () => {
            cleanup();
            resolve();
          };
          image.src = '/assets/travel-photo.svg';
        });
        await abortable(image.decode(), signal);
        signal.throwIfAborted();
        store.photo = 'visible';
        await painted(signal);
        const displayed = document.querySelector<HTMLImageElement>('[data-photo]');
        if (
          !displayed?.complete ||
          displayed.naturalWidth === 0 ||
          displayed.getBoundingClientRect().width === 0
        )
          throw new Error('PHOTO_NOT_VISIBLE');
      } catch (error) {
        image.src = '';
        if (!ownerSignal.aborted) store.photo = 'failed';
        throw error;
      }
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
    clear() {
      store.photo = 'hidden';
      if (pendingEnvironment) {
        store.environment = pendingEnvironment.previous;
        pendingEnvironment = undefined;
      }
    },
  };
}
