// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLive2DRenderer } from './live2d.js';
import { abortableLoad, validateHaruSettings } from './live2d-loader.js';
import { HARU_MANIFEST, bindHaruParameters, poseParameters } from './live2d-manifest.js';
import type { CharacterFrame } from './character.js';
import type {
  CubismParameters,
  Live2DApplication,
  Live2DModelPort,
  Live2DRuntime,
} from './live2d-types.js';

const frame: CharacterFrame = {
  interaction: 'speaking',
  emotion: 'curious',
  action: 'lookWindow',
  mouthOpen: 0.7,
  photoInHand: false,
};
function core(): CubismParameters & { values: Map<string, number> } {
  const values = new Map<string, number>();
  return {
    values,
    getParameterCount: () => HARU_MANIFEST.parameters.length,
    getParameterIndex: (id) => HARU_MANIFEST.parameters.findIndex((name) => name === id),
    getParameterMinimumValue: () => -30,
    getParameterMaximumValue: () => 30,
    setParameterValueById: (id, value) => {
      values.set(id, value);
    },
  };
}
function fixture() {
  const models: Array<
    Live2DModelPort & {
      complete(): void;
      fail(): void;
      redraw(): void;
      destroyed: number;
      emissions: string[];
      stops: number;
    }
  > = [];
  const applications: FakeApplication[] = [];
  const parameters = core();
  const fallbackDestroy = vi.fn();
  class FakeApplication implements Live2DApplication {
    renderer = { resize: vi.fn() };
    stage = { addChild: vi.fn(), removeChild: vi.fn() };
    callbacks = new Set<() => void>();
    ticker = {
      maxFPS: 0,
      deltaMS: 33,
      add: (cb: () => void) => {
        this.callbacks.add(cb);
      },
      remove: (cb: () => void) => {
        this.callbacks.delete(cb);
      },
    };
    start = vi.fn();
    stop = vi.fn();
    destroy = vi.fn();
    constructor() {
      applications.push(this);
    }
  }
  const runtime: Live2DRuntime = {
    Application: FakeApplication,
    Container: { prototype: { destroy: fallbackDestroy } },
    Texture: { fromURL: vi.fn(async () => ({ destroy: vi.fn() })) },
    live2d: {
      Cubism4ModelSettings: class {
        resolveURL(path: string) {
          return path;
        }
      },
      Live2DModel: {
        fromSync: (_settings, options) => {
          const callbacks = new Set<() => void>();
          const model = {
            destroyed: 0,
            emissions: [] as string[],
            stops: 0,
            internalModel: {
              originalWidth: 2000,
              originalHeight: 3000,
              coreModel: parameters,
              motionManager: {
                stopAllMotions: () => {
                  model.stops++;
                },
              },
              on: (_event: 'beforeModelUpdate', callback: () => void) => {
                callbacks.add(callback);
              },
              off: (_event: 'beforeModelUpdate', callback: () => void) => {
                callbacks.delete(callback);
              },
            },
            scale: { set: vi.fn() },
            anchor: { set: vi.fn() },
            position: { set: vi.fn() },
            update: vi.fn(),
            emit: (event: string) => {
              model.emissions.push(event);
            },
            destroy: () => {
              model.destroyed++;
            },
            complete: () => options.onLoad(),
            fail: () => options.onError(new Error('load failed')),
            redraw: () => {
              for (const cb of callbacks) cb();
            },
          };
          models.push(model);
          return model;
        },
      },
    },
  };
  const prepared = { settings: { resolveURL: (path: string) => path }, dispose: vi.fn() };
  const canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 390, 600));
  document.body.append(canvas);
  return { runtime, prepared, canvas, models, applications, parameters, fallbackDestroy };
}
let disconnected = 0;
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {
        disconnected++;
      }
    },
  );
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.spyOn(performance, 'now').mockReturnValue(2000);
  disconnected = 0;
});
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Haru manifest and parameter ownership', () => {
  it('rejects remote paths, injected motions and unknown sample layouts', () => {
    const source = {
      Version: 3,
      FileReferences: {
        Moc: 'Haru.moc3',
        Textures: ['Haru.2048/texture_00.png', 'Haru.2048/texture_01.png'],
        Physics: 'Haru.physics3.json',
        Pose: 'Haru.pose3.json',
      },
    };
    expect(validateHaruSettings(source).textures).toHaveLength(2);
    expect(() =>
      validateHaruSettings({
        ...source,
        FileReferences: { ...source.FileReferences, Moc: 'https://untrusted.invalid/model.moc3' },
      }),
    ).toThrow('MANIFEST_FILES');
    expect(() =>
      validateHaruSettings({
        ...source,
        FileReferences: { ...source.FileReferences, Motions: { Idle: [{ Sound: 'voice.mp3' }] } },
      }),
    ).toThrow('MANIFEST_FILES');
  });
  it('does not treat fabricated Cubism indices as supported parameters', () => {
    const model = core();
    model.getParameterIndex = () => model.getParameterCount();
    expect(() => bindHaruParameters(model)).toThrow('PARAMETER_MISSING');
  });
  it('clamps to the real model bounds and refuses non-finite audio values', () => {
    const model = core();
    model.getParameterMinimumValue = () => 0;
    model.getParameterMaximumValue = () => 1;
    const write = bindHaruParameters(model);
    write('ParamMouthOpenY', 15);
    expect(model.values.get('ParamMouthOpenY')).toBe(1);
    expect(() => write('ParamMouthOpenY', Number.NaN)).toThrow('PARAMETER_VALUE');
  });
  it('keeps non-speaking mouths closed and reduced motion expressive but stable', () => {
    const listening = poseParameters({ ...frame, interaction: 'listening' }, 1, true);
    expect(listening.ParamMouthOpenY).toBe(0);
    expect(listening).toEqual(poseParameters({ ...frame, interaction: 'listening' }, 6, true));
    const guarded = poseParameters({ ...frame, emotion: 'guarded' }, 1, true);
    const relieved = poseParameters({ ...frame, emotion: 'relieved' }, 1, true);
    expect(guarded.ParamMouthForm).toBeLessThan(relieved.ParamMouthForm);
    const resting = poseParameters(
      { ...frame, interaction: 'idle', emotion: 'guarded', action: 'none' },
      1,
      true,
    );
    const attentive = poseParameters(
      { ...frame, interaction: 'listening', emotion: 'guarded', action: 'none' },
      1,
      true,
    );
    const thinking = poseParameters(
      { ...frame, interaction: 'thinking', emotion: 'guarded', action: 'none' },
      1,
      true,
    );
    // A reserved resting face stays awake and approachable; interaction changes the actual silhouette.
    expect(resting.ParamEyeLOpen).toBeGreaterThanOrEqual(0.9);
    expect(resting.ParamMouthForm).toBeGreaterThanOrEqual(0);
    expect(attentive.ParamBodyAngleY).toBeGreaterThan(resting.ParamBodyAngleY);
    expect(attentive.ParamAngleZ).toBeLessThan(resting.ParamAngleZ - 8);
    expect(thinking.ParamAngleZ).toBeGreaterThan(resting.ParamAngleZ + 8);
    expect(thinking.ParamEyeBallY).toBeGreaterThan(resting.ParamEyeBallY);
    expect(HARU_MANIFEST.capabilities.specializedPhotoGesture).toBe(false);
  });
});

describe('Live2D renderer lifecycle', () => {
  it('owns one ticker, applies actual audio energy and synchronously cancels mouth/actions', async () => {
    const f = fixture(),
      owner = new AbortController();
    const loading = createLive2DRenderer(f.canvas, f.runtime, f.prepared, owner.signal);
    const model = f.models[0];
    if (!model) throw new Error('no model');
    model.complete();
    const renderer = await loading;
    expect(f.applications[0]?.ticker.maxFPS).toBe(30);
    expect(f.applications[0]?.callbacks.size).toBe(1);
    renderer.update(frame);
    model.redraw();
    expect(f.parameters.values.get('ParamMouthOpenY')).toBe(0.7);
    expect(f.parameters.values.get('ParamAngleX')).toBe(-27);
    renderer.cancel();
    expect(f.parameters.values.get('ParamMouthOpenY')).toBe(0);
    model.redraw();
    expect(f.parameters.values.get('ParamAngleX')).toBe(0);
    renderer.dispose();
    expect(f.prepared.dispose).toHaveBeenCalledOnce();
    expect(model.destroyed).toBe(1);
    expect(f.applications[0]?.destroy).toHaveBeenCalledWith(false, {
      children: false,
      texture: false,
      baseTexture: false,
    });
    expect(disconnected).toBe(1);
    expect(document.body.contains(f.canvas)).toBe(true);
  });
  it('drops stale load completion after cancellation without touching a new renderer', async () => {
    const first = fixture(),
      old = new AbortController();
    const oldPromise = createLive2DRenderer(
      first.canvas,
      first.runtime,
      first.prepared,
      old.signal,
    );
    const rejected = expect(oldPromise).rejects.toBeDefined();
    old.abort();
    await rejected;
    const second = fixture(),
      next = new AbortController();
    const nextPromise = createLive2DRenderer(
      second.canvas,
      second.runtime,
      second.prepared,
      next.signal,
    );
    second.models[0]?.complete();
    const renderer = await nextPromise;
    first.models[0]?.complete();
    expect(first.models[0]?.destroyed).toBe(1);
    expect(first.prepared.dispose).toHaveBeenCalledOnce();
    expect(second.models[0]?.destroyed).toBe(0);
    renderer.update(frame);
    second.models[0]?.redraw();
    expect(second.parameters.values.get('ParamMouthOpenY')).toBe(0.7);
    renderer.dispose();
  });
  it('keeps owner abort attached after successful initialization', async () => {
    const f = fixture(),
      owner = new AbortController();
    const loading = createLive2DRenderer(f.canvas, f.runtime, f.prepared, owner.signal);
    f.models[0]?.complete();
    const renderer = await loading;
    owner.abort();
    expect(f.models[0]?.destroyed).toBe(1);
    expect(f.applications[0]?.callbacks.size).toBe(0);
    renderer.dispose();
    expect(f.prepared.dispose).toHaveBeenCalledOnce();
  });
  it('reports context loss once, destroys resources and ignores later model callbacks', async () => {
    const f = fixture(),
      owner = new AbortController(),
      failure = vi.fn();
    const loading = createLive2DRenderer(f.canvas, f.runtime, f.prepared, owner.signal, {
      onFailure: failure,
    });
    f.models[0]?.complete();
    await loading;
    f.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    f.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(failure).toHaveBeenCalledOnce();
    expect(f.models[0]?.destroyed).toBe(1);
    expect(f.prepared.dispose).toHaveBeenCalledOnce();
    f.models[0]?.complete();
    expect(f.prepared.dispose).toHaveBeenCalledOnce();
  });
  it('stops ticking in hidden documents and resumes without creating another ticker', async () => {
    const f = fixture(),
      owner = new AbortController();
    const loading = createLive2DRenderer(f.canvas, f.runtime, f.prepared, owner.signal);
    f.models[0]?.complete();
    const renderer = await loading;
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(f.applications[0]?.stop).toHaveBeenCalled();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(f.applications[0]?.start).toHaveBeenCalledTimes(2);
    expect(f.applications[0]?.callbacks.size).toBe(1);
    renderer.dispose();
  });
  it('failed parameter validation destroys the partial model and loaded textures', async () => {
    const f = fixture(),
      owner = new AbortController();
    f.parameters.getParameterCount = () => 0;
    const loading = createLive2DRenderer(f.canvas, f.runtime, f.prepared, owner.signal);
    f.models[0]?.complete();
    await expect(loading).rejects.toThrow('PARAMETER_COUNT');
    expect(f.models[0]?.destroyed).toBe(1);
    expect(f.prepared.dispose).toHaveBeenCalledOnce();
  });
  it('load timeout cancels a noncooperative SDK then reclaims its late model', async () => {
    const f = fixture(),
      owner = new AbortController(),
      timeout = new AbortController();
    const loading = createLive2DRenderer(
      f.canvas,
      f.runtime,
      f.prepared,
      owner.signal,
      {},
      timeout.signal,
    );
    const rejection = expect(loading).rejects.toThrow('timeout');
    timeout.abort(new Error('timeout'));
    await rejection;
    expect(f.models[0]?.emissions).toContain('destroy');
    expect(f.prepared.dispose).toHaveBeenCalledOnce(); // No texture/Blob is retained while the SDK is pending.
    f.models[0]?.complete();
    expect(f.models[0]?.destroyed).toBe(1);
    expect(f.applications[0]?.start).not.toHaveBeenCalled();
  });
  it('releases prepared assets even if an aborted SDK never finishes creating its Core', async () => {
    const f = fixture(),
      owner = new AbortController();
    const loading = createLive2DRenderer(f.canvas, f.runtime, f.prepared, owner.signal);
    const model = f.models[0];
    if (!model) throw new Error('model missing');
    model.internalModel = undefined;
    const rejection = expect(loading).rejects.toBeDefined();
    owner.abort();
    await rejection;
    expect(f.prepared.dispose).toHaveBeenCalledOnce();
    expect(f.applications[0]?.destroy).toHaveBeenCalledOnce();
    model.fail();
    expect(f.fallbackDestroy).toHaveBeenCalledOnce();
    expect(f.prepared.dispose).toHaveBeenCalledOnce();
  });
  it('destroys values that arrive after an aborted resource promise', async () => {
    const owner = new AbortController();
    let complete: ((value: string) => void) | undefined;
    const source = new Promise<string>((resolve) => {
      complete = resolve;
    });
    const late = vi.fn();
    const pending = abortableLoad(source, owner.signal, late);
    const rejection = expect(pending).rejects.toBeDefined();
    owner.abort();
    await rejection;
    complete?.('obsolete');
    await Promise.resolve();
    expect(late).toHaveBeenCalledWith('obsolete');
  });
});
