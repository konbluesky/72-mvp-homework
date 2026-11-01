// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
import type PixiStage from '../../engine/webgal/Core/controller/stage/pixi/PixiController';
const mock = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../../engine/webgal/Core/WebGAL', () => ({
  Live2D: { initializeCubism4: async () => undefined },
}));
vi.mock('pixi-live2d-display-webgal/cubism4', () => ({
  Live2DModel: { from: mock.from },
  config: {},
  baseBlinkParam: {},
  MotionPreloadStrategy: { NONE: 'NONE' },
}));
import { CharacterDriver } from './driver';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function model() {
  const container = new Container();
  const core = {
    getParameterCount: () => 138,
    getParameterIndex: () => 1,
    getParameterMinimumValue: () => -30,
    getParameterMaximumValue: () => 30,
    getParameterDefaultValue: () => 0,
    getPartCount: () => 4,
    getPartIndex: (id: string) =>
      ['Part01ArmRA001', 'Part01ArmLA001', 'Part01ArmRB001', 'Part01ArmLB001'].indexOf(id),
    setPartOpacityByIndex: vi.fn(),
  };
  const fake = Object.assign(container, {
    internalModel: {
      originalHeight: 1440,
      coreModel: core,
      motionManager: { stopAllMotions: vi.fn() },
      setBlinkParam: vi.fn(),
      on: vi.fn(),
    },
    anchor: { set: vi.fn() },
    update: vi.fn(),
  });
  vi.spyOn(fake, 'destroy');
  return fake;
}
const tick = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});
it('destroys only a superseded character result, once, without destroying the newer model or shared textures', async () => {
  vi.useFakeTimers();
  const a = deferred<ReturnType<typeof model>>(),
    b = deferred<ReturnType<typeof model>>();
  mock.from.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const stage = {
    figureContainer: new Container(),
    registerAnimation: vi.fn(),
    removeAnimationWithoutSetEndState: vi.fn(),
    currentApp: { render: vi.fn() },
  } as unknown as PixiStage;
  const driver = new CharacterDriver(stage, () => true);
  const first = driver.select('miara', new AbortController().signal);
  const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  await tick();
  const second = driver.select('haru', new AbortController().signal);
  await tick();
  const current = model();
  b.resolve(current);
  await second;
  const late = model();
  a.resolve(late);
  await rejected;
  expect(late.destroy).toHaveBeenCalledTimes(1);
  expect(late.destroy).toHaveBeenCalledWith({ children: true, texture: false, baseTexture: false });
  expect(current.destroy).not.toHaveBeenCalled();
  expect(driver.root.children).toEqual([current]);
  driver.dispose();
  expect(current.destroy).toHaveBeenCalledTimes(1);
});
