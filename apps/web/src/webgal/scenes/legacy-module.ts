import type { Component } from 'vue';
import type { PresentationPort } from '../../playback/scheduler.js';
import type { SceneStore } from '../../stores/scene.js';

/** Authored public content and visuals injected into the Vue conversation shell. */
export interface LegacySceneModule {
  id: string;
  version: string;
  title: string;
  speaker: string;
  speakerDescription: string;
  opening: string;
  locationLabel: string;
  environmentLabel(environment: string): string;
  photo: { url: string; alt: string; caption: string };
  about: { title: string; description: string; attribution: string };
  backdrop: Component;
  createPresentation(store: SceneStore): PresentationPort;
}
