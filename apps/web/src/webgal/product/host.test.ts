// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { initialStory } from '@mira/protocol';
import type { SceneModule, ScenePresentation } from '../scenes/module.js';

vi.mock('../runtime/bootstrap', () => ({
  createInteractiveEngine: () => ({
    initialize: async () => ({ stage: {} }),
    dispose: vi.fn(),
  }),
}));
vi.mock('../characters/driver', () => ({
  CharacterDriver: class {
    select = async () => {};
    update = () => {};
    dispose = () => {};
  },
}));
import { InteractiveHost } from './host.js';

function presentation(restore: ScenePresentation['restore']): ScenePresentation {
  return {
    restore,
    photo: async () => {},
    environment: async () => {},
    execute: async () => {},
    camera() {},
    dismiss() {},
    clear() {},
    dispose() {},
  };
}

it('ignores an old projection failure after the stage was rebuilt', async () => {
  let rejectOld!: (reason: Error) => void;
  const pending = new Promise<void>((_, reject) => {
    rejectOld = reject;
  });
  const current = presentation(async () => {});
  const scene: SceneModule = {
    id: 'sample-story',
    version: '1',
    title: 'Sample',
    subtitle: '',
    speaker: 'Guide',
    phaseLabels: {},
    characters: ['haru'],
    defaultCharacter: 'haru',
    assets: [],
    initialView: { story: initialStory(), environment: 'default' },
    location: () => {
      throw new Error('No location required');
    },
    createPresentation: () => current,
    environmentPreviews: [],
  };
  const host = new InteractiveHost(scene);
  host.state.connected = true;
  host.presentation = presentation(() => pending);
  host.state.story = { ...host.state.story, revision: 1 };
  await Promise.resolve();
  await host.rebuildStage();
  expect(host.presentation).toBe(current);
  expect(host.state.animation).toBe('live2d');
  rejectOld(new Error('OLD_RESOURCE_FAILED'));
  await Promise.resolve();
  await Promise.resolve();
  expect(host.state.failure).toBe('');
  host.dispose();
});
