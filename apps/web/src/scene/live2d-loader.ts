import { HARU_MANIFEST } from './live2d-manifest.js';
import type {
  Live2DRuntime,
  Live2DTexture,
  ModelSettings,
  ResolvedModelSettings,
} from './live2d-types.js';

const scripts = new Map<string, Promise<void>>();
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
function isRuntime(value: unknown): value is Live2DRuntime {
  return (
    isObject(value) &&
    typeof value.Application === 'function' &&
    typeof value.Container === 'function' &&
    typeof value.Texture === 'function' &&
    'fromURL' in value.Texture &&
    typeof value.Texture.fromURL === 'function' &&
    isObject(value.live2d) &&
    typeof value.live2d.Cubism4ModelSettings === 'function' &&
    typeof value.live2d.Live2DModel === 'function' &&
    'fromSync' in value.live2d.Live2DModel &&
    typeof value.live2d.Live2DModel.fromSync === 'function'
  );
}
function loadScript(path: string): Promise<void> {
  const existing = scripts.get(path);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = path;
    script.async = true;
    const finish = (error?: Error) => {
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      if (error) {
        script.remove();
        scripts.delete(path);
        reject(error);
      } else resolve();
    };
    const timer = setTimeout(() => finish(new Error('LIVE2D_RUNTIME_TIMEOUT')), 10_000);
    script.onload = () => finish();
    script.onerror = () => finish(new Error('LIVE2D_RUNTIME_UNAVAILABLE'));
    document.head.append(script);
  });
  scripts.set(path, promise);
  return promise;
}
export function abortableLoad<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  late?: (value: T) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const aborted = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', aborted);
      reject(signal.reason ?? new Error('LIVE2D_CANCELLED'));
    };
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
    promise.then(
      (value) => {
        signal.removeEventListener('abort', aborted);
        if (settled) {
          late?.(value);
          return;
        }
        settled = true;
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', aborted);
        if (!settled) {
          settled = true;
          reject(error);
        }
      },
    );
  });
}
export async function loadRuntime(signal: AbortSignal): Promise<Live2DRuntime> {
  for (const path of HARU_MANIFEST.libraries) {
    signal.throwIfAborted();
    await abortableLoad(loadScript(path), signal);
  }
  signal.throwIfAborted();
  const pixi: unknown = Reflect.get(globalThis, 'PIXI');
  if (!isRuntime(pixi) || !Reflect.get(globalThis, 'Live2DCubismCore'))
    throw new Error('LIVE2D_RUNTIME_CONTRACT');
  if (pixi.live2d.config) pixi.live2d.config.sound = false;
  return pixi;
}
async function bytes(
  path: string,
  limit: number,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(path, { signal, cache: 'force-cache' });
  if (!response.ok || Number(response.headers.get('content-length')) > limit || !response.body) {
    await response.body?.cancel();
    throw new Error('LIVE2D_ASSET_UNAVAILABLE');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      size += part.value.length;
      if (size > limit) throw new Error('LIVE2D_ASSET_LIMIT');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (!size) throw new Error('LIVE2D_EMPTY_ASSET');
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
function parseObject(data: Uint8Array): Record<string, unknown> {
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
  if (!isObject(value)) throw new Error('LIVE2D_ASSET_JSON');
  return value;
}
export function validateHaruSettings(value: unknown): {
  moc: string;
  textures: string[];
  physics: string;
  pose: string;
} {
  if (!isObject(value) || value.Version !== 3 || !isObject(value.FileReferences))
    throw new Error('LIVE2D_MANIFEST');
  const files = value.FileReferences;
  if (
    files.Moc !== 'Haru.moc3' ||
    files.Physics !== 'Haru.physics3.json' ||
    files.Pose !== 'Haru.pose3.json' ||
    !Array.isArray(files.Textures) ||
    files.Textures.length !== 2 ||
    files.Textures[0] !== 'Haru.2048/texture_00.png' ||
    files.Textures[1] !== 'Haru.2048/texture_01.png' ||
    files.Motions !== undefined ||
    files.Expressions !== undefined
  )
    throw new Error('LIVE2D_MANIFEST_FILES');
  return {
    moc: files.Moc,
    textures: ['Haru.2048/texture_00.png', 'Haru.2048/texture_01.png'],
    physics: files.Physics,
    pose: files.Pose,
  };
}
export interface PreparedModel {
  settings: ResolvedModelSettings;
  dispose(): void;
}
export async function prepareModel(
  runtime: Live2DRuntime,
  signal: AbortSignal,
): Promise<PreparedModel> {
  const settings = validateHaruSettings(
    parseObject(await bytes(HARU_MANIFEST.model, 65_536, signal)),
  );
  const urls: string[] = [];
  const textures: Live2DTexture[] = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const texture of textures) if (!texture.destroyed) texture.destroy(true);
    for (const url of urls) URL.revokeObjectURL(url);
  };
  const resource = async (file: string, mime: string, limit: number) => {
    const data = await bytes(`/assets/live2d/haru/${file}`, limit, signal);
    signal.throwIfAborted();
    if (disposed) throw new Error('LIVE2D_CANCELLED');
    if (mime === 'application/json') parseObject(data);
    if (file.endsWith('.moc3') && new TextDecoder().decode(data.subarray(0, 4)) !== 'MOC3')
      throw new Error('LIVE2D_MOC_SIGNATURE');
    if (
      mime === 'image/png' &&
      ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => data[index] === byte)
    )
      throw new Error('LIVE2D_TEXTURE_SIGNATURE');
    const url = URL.createObjectURL(new Blob([data], { type: mime }));
    urls.push(url);
    return url;
  };
  try {
    const [moc, physics, pose, ...images] = await Promise.all([
      resource(settings.moc, 'application/octet-stream', 1_048_576),
      resource(settings.physics, 'application/json', 65_536),
      resource(settings.pose, 'application/json', 65_536),
      ...settings.textures.map((file) => resource(file, 'image/png', 3_145_728)),
    ]);
    if (!moc || !physics || !pose) throw new Error('LIVE2D_ASSETS');
    // Each mount gets private Blob URLs. An old load can never destroy a newer model's cached textures.
    for (const url of images) {
      const texture = await abortableLoad(runtime.Texture.fromURL(url), signal, (late) => {
        if (!late.destroyed) late.destroy(true);
      });
      textures.push(texture);
    }
    signal.throwIfAborted();
    const source: ModelSettings = {
      Version: 3,
      url: new URL(HARU_MANIFEST.model, location.origin).href,
      FileReferences: { Moc: moc, Textures: images, Physics: physics, Pose: pose },
    };
    const resolved = new runtime.live2d.Cubism4ModelSettings(source);
    // The wrapper's legacy URL resolver corrupts blob:http:// into blob:http//.
    // Its public ModelSettings instance hook preserves only this mount's validated resources.
    resolved.resolveURL = (path) => {
      if (!urls.includes(path)) throw new Error('LIVE2D_UNOWNED_ASSET');
      return path;
    };
    return { settings: resolved, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
