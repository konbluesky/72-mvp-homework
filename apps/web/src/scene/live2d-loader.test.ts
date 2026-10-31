// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { prepareModel } from './live2d-loader.js';
import type {
  Live2DApplication,
  Live2DRuntime,
  Live2DTexture,
  ModelSettings,
} from './live2d-types.js';

const manifest = {
  Version: 3,
  FileReferences: {
    Moc: 'Haru.moc3',
    Textures: ['Haru.2048/texture_00.png', 'Haru.2048/texture_01.png'],
    Physics: 'Haru.physics3.json',
    Pose: 'Haru.pose3.json',
  },
};
function setup() {
  let sequence = 0;
  const created = vi
    .spyOn(URL, 'createObjectURL')
    .mockImplementation(() => `blob:http://localhost/${++sequence}`);
  const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const fetcher = vi.fn<typeof fetch>(async (path) => {
    const url = String(path);
    if (url.endsWith('model3.json')) return new Response(JSON.stringify(manifest));
    if (url.endsWith('.moc3')) return new Response('MOC3-valid-test-fixture');
    if (url.endsWith('.png'))
      return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]));
    return new Response('{}');
  });
  vi.stubGlobal('fetch', fetcher);
  const textures: Live2DTexture[] = [];
  let source: ModelSettings | undefined;
  class Settings {
    constructor(value: ModelSettings) {
      source = value;
    }
    resolveURL(path: string): string {
      return path.replace('http:', 'http');
    }
  }
  class UnusedApplication implements Live2DApplication {
    renderer = { resize: vi.fn() };
    stage = { addChild: vi.fn(), removeChild: vi.fn() };
    ticker = { maxFPS: 30, deltaMS: 30, add: vi.fn(), remove: vi.fn() };
    start = vi.fn();
    stop = vi.fn();
    destroy = vi.fn();
  }
  const runtime: Live2DRuntime = {
    Application: UnusedApplication,
    Container: { prototype: { destroy: vi.fn() } },
    Texture: {
      fromURL: vi.fn(async () => {
        const texture: Live2DTexture = {
          destroyed: false,
          destroy: vi.fn(() => {
            texture.destroyed = true;
          }),
        };
        textures.push(texture);
        return texture;
      }),
    },
    live2d: {
      Cubism4ModelSettings: Settings,
      Live2DModel: {
        fromSync: () => {
          throw new Error('unused');
        },
      },
    },
  };
  return { runtime, created, revoked, fetcher, textures, source: () => source };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('preserves private Blob URLs through the public settings hook and revokes all owned resources', async () => {
  const f = setup();
  const first = await prepareModel(f.runtime, new AbortController().signal);
  const source = f.source();
  if (!source) throw new Error('settings missing');
  expect(first.settings.resolveURL(source.FileReferences.Moc)).toBe(source.FileReferences.Moc);
  expect(() => first.settings.resolveURL('https://untrusted.invalid/asset')).toThrow(
    'UNOWNED_ASSET',
  );
  const second = await prepareModel(f.runtime, new AbortController().signal);
  expect(f.source()?.FileReferences.Moc).not.toBe(source.FileReferences.Moc);
  first.dispose();
  expect(f.textures.slice(0, 2).every((texture) => texture.destroyed)).toBe(true);
  expect(f.textures.slice(2).every((texture) => !texture.destroyed)).toBe(true);
  expect(f.revoked).toHaveBeenCalledTimes(5);
  first.dispose();
  expect(f.revoked).toHaveBeenCalledTimes(5);
  second.dispose();
  expect(f.revoked).toHaveBeenCalledTimes(10);
});

it('releases every texture and Blob when cancellation wins a late decode', async () => {
  const f = setup(),
    owner = new AbortController();
  let complete: ((texture: Live2DTexture) => void) | undefined;
  f.runtime.Texture.fromURL = () =>
    new Promise((resolve) => {
      complete = resolve;
    });
  const pending = prepareModel(f.runtime, owner.signal);
  await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
  const rejected = expect(pending).rejects.toBeDefined();
  owner.abort();
  await rejected;
  expect(f.revoked).toHaveBeenCalledTimes(5);
  const destroy = vi.fn();
  complete?.({ destroy });
  await Promise.resolve();
  expect(destroy).toHaveBeenCalledOnce();
});

it('rejects invalid signatures without constructing a model or leaking completed resources', async () => {
  const f = setup();
  const original = f.fetcher.getMockImplementation();
  if (!original) throw new Error('fetch implementation missing');
  f.fetcher.mockImplementation((path, init) =>
    String(path).endsWith('.png')
      ? Promise.resolve(new Response('not a texture'))
      : original(path, init),
  );
  await expect(prepareModel(f.runtime, new AbortController().signal)).rejects.toThrow(
    'TEXTURE_SIGNATURE',
  );
  expect(f.runtime.Texture.fromURL).not.toHaveBeenCalled();
  expect(f.revoked).toHaveBeenCalledTimes(f.created.mock.calls.length);
});
