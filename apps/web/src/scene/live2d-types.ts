/** Narrow ports for the bundled Pixi 6.5.10 / pixi-live2d-display 0.4.0 APIs. */
export interface CubismParameters {
  getParameterCount(): number;
  getParameterIndex(id: string): number;
  getParameterMinimumValue(index: number): number;
  getParameterMaximumValue(index: number): number;
  setParameterValueById(id: string, value: number): void;
}
export interface CubismParts {
  getPartCount(): number;
  getPartIndex(id: string): number;
  setPartOpacityByIndex(index: number, value: number): void;
}
export interface Live2DTexture {
  destroyed?: boolean;
  destroy(baseTexture?: boolean): void;
}
export interface Live2DModelPort {
  internalModel?: {
    originalWidth: number;
    originalHeight: number;
    coreModel: CubismParameters & CubismParts;
    motionManager: { stopAllMotions(): void };
    on(event: 'beforeModelUpdate', callback: () => void): void;
    off(event: 'beforeModelUpdate', callback: () => void): void;
  };
  scale: { set(value: number): void };
  anchor: { set(x: number, y: number): void };
  position: { set(x: number, y: number): void };
  update(milliseconds: number): void;
  emit(event: string): void;
  destroy(options: { children: boolean; texture: boolean; baseTexture: boolean }): void;
}
export interface Live2DApplication {
  renderer: { resize(width: number, height: number): void };
  stage: { addChild(model: Live2DModelPort): void; removeChild(model: Live2DModelPort): void };
  ticker: {
    maxFPS: number;
    deltaMS: number;
    add(callback: () => void): void;
    remove(callback: () => void): void;
  };
  start(): void;
  stop(): void;
  destroy(
    removeView: boolean,
    options: { children: boolean; texture: boolean; baseTexture: boolean },
  ): void;
}
export interface ModelSettings {
  Version: 3;
  url: string;
  FileReferences: { Moc: string; Textures: string[]; Physics?: string; Pose?: string };
}
export interface ResolvedModelSettings {
  resolveURL(path: string): string;
}
export interface Live2DRuntime {
  Application: new (options: {
    view: HTMLCanvasElement;
    autoStart: boolean;
    sharedTicker: boolean;
    backgroundAlpha: number;
    antialias: boolean;
    resolution: number;
    autoDensity: boolean;
  }) => Live2DApplication;
  Container: { prototype: { destroy: (options: { children: boolean }) => void } };
  Texture: { fromURL(url: string): Promise<Live2DTexture> };
  live2d: {
    config?: { sound: boolean };
    Cubism4ModelSettings: new (settings: ModelSettings) => ResolvedModelSettings;
    Live2DModel: {
      fromSync(
        settings: ModelSettings | ResolvedModelSettings,
        options: {
          autoInteract: boolean;
          autoUpdate: boolean;
          idleMotionGroup: string;
          motionPreload: 'NONE';
          onLoad(): void;
          onError(error: unknown): void;
        },
      ): Live2DModelPort;
    };
  };
}
