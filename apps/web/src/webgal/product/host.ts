import { Point } from 'pixi.js';
import { initialInteractiveState, type InteractiveState } from '../../interaction/state.js';
import { TurnController } from '../../interaction/turn-controller.js';
import { ApiClient } from '../../api/client.js';
import { BrowserAudio } from '../../playback/audio.js';
import { PlaybackScheduler } from '../../playback/scheduler.js';
import { ConnectionMonitor } from '../../connection/monitor.js';
import { createInteractiveEngine } from '../runtime/bootstrap';
import { CharacterDriver, type CharacterId } from '../characters/driver';
import type { SceneModule, ScenePresentation } from '../scenes/module.js';

/** Composition root: React owns no audio, session facts or autonomous story clocks. */
export class InteractiveHost {
  readonly state: InteractiveState;
  private snapshot: InteractiveState;
  private listeners = new Set<() => void>();
  private engine: ReturnType<typeof createInteractiveEngine>;
  private lifetime = new AbortController();
  private stageLifetime = new AbortController();
  private stageAttempt = 0;
  private characterLoad = new AbortController();
  private actor?: CharacterDriver;
  private stage?: import('../../engine/webgal/Core/controller/stage/pixi/PixiController').default;
  presentation?: ScenePresentation;
  private disposed = false;
  private started = false;
  private restoreQueued = false;
  readonly api: ApiClient;
  readonly playback: PlaybackScheduler;
  readonly controller: TurnController;
  private monitor: ConnectionMonitor;
  characterId: CharacterId;
  characterError = '';
  constructor(readonly scene: SceneModule) {
    this.api = new ApiClient(undefined, undefined, 'story', {
      id: scene.id,
      version: scene.version,
    });
    this.engine = createInteractiveEngine(scene.assets);
    this.characterId = scene.defaultCharacter;
    const initial = initialInteractiveState();
    initial.story = scene.initialView.story;
    initial.environment = scene.initialView.environment;
    this.snapshot = { ...initial };
    this.state = new Proxy(initial, {
      set: (target, key, value) => {
        Reflect.set(target, key, value);
        this.actor?.update({
          interaction: target.interaction,
          emotion: target.emotion,
          action: target.action,
          mouthOpen: target.mouthOpen,
          photoInHand: target.action === 'offerPhoto',
        });
        this.presentation?.camera(target.action);
        this.snapshot = { ...target };
        for (const listener of this.listeners) listener();
        if (key === 'story' || key === 'environment') this.restoreProjection();
        return true;
      },
    });
    this.playback = new PlaybackScheduler({
      audio: new BrowserAudio((path, signal) => this.api.media(path, signal)),
      presentation: {
        photo: (event, signal) => {
          if (!this.presentation) throw new Error('STAGE_NOT_READY');
          return this.presentation.photo(event, signal);
        },
        environment: (event, signal) => {
          if (!this.presentation) throw new Error('STAGE_NOT_READY');
          return this.presentation.environment(event, signal);
        },
        execute: (event, signal) => {
          if (!this.presentation) throw new Error('STAGE_NOT_READY');
          return this.presentation.execute(event, signal);
        },
        previewScene: (zoom, weather, signal) => {
          if (!this.presentation) throw new Error('STAGE_NOT_READY');
          return this.presentation.previewScene?.(zoom, weather, signal) ?? Promise.resolve();
        },
        previewMotion: (group) => this.actor?.previewOriginal(group),
        errorMessage: (event) =>
          this.presentation?.errorMessage?.(event) ?? '场景呈现未完成，请重试。',
        clear: () => this.presentation?.clear(),
      },
      view: (value) => Object.assign(this.state, value),
      receipt: (receipt, turn) => this.controller.receipt(receipt, turn),
      failure: (message) => {
        this.state.failure = message;
      },
      expired: (turn) => this.controller.expire(turn),
      cancelled: (turn) => this.controller.expire(turn),
    });
    this.controller = new TurnController(this.api, this.playback, this.state);
    this.monitor = new ConnectionMonitor(this.api, {
      view: (value) => {
        this.state.connection = value;
      },
      reachable: () => {
        void this.controller.recoverConnection();
      },
      unavailable: () => this.controller.connectionLost(),
    });
  }
  get location() {
    return this.scene.location(this.state.story.location);
  }
  get phaseLabel() {
    return this.scene.phaseLabels[this.state.story.phase] ?? this.state.story.phase;
  }
  get characterParameters() {
    return this.actor?.parameters ?? [];
  }
  get isDisposed() {
    return this.disposed;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  async start() {
    if (this.started) return;
    this.started = true;
    if (document.hidden)
      await new Promise<void>((resolve) => {
        const visible = () => {
          if (document.hidden && !this.disposed) return;
          document.removeEventListener('visibilitychange', visible);
          this.lifetime.signal.removeEventListener('abort', visible);
          resolve();
        };
        document.addEventListener('visibilitychange', visible);
        this.lifetime.signal.addEventListener('abort', visible, { once: true });
      });
    if (this.disposed) return;
    await this.mountStage(true);
    if (this.disposed) return;
    this.monitor.start();
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) {
          this.controller.interrupt();
          this.controller.pauseRecovery();
          this.monitor.suspend();
        } else {
          this.monitor.start();
          void this.controller.recoverConnection(true, true);
        }
      },
      { signal: this.lifetime.signal },
    );
    window.addEventListener(
      'offline',
      () => {
        this.monitor.offline();
        this.controller.connectionLost();
      },
      { signal: this.lifetime.signal },
    );
    window.addEventListener('online', () => this.reconnect(), { signal: this.lifetime.signal });
  }
  private async mountStage(connect: boolean) {
    const attempt = ++this.stageAttempt,
      engine = this.engine,
      signal = this.stageLifetime.signal;
    const valid = () => !this.disposed && !signal.aborted && attempt === this.stageAttempt;
    try {
      const lease = await engine.initialize();
      if (!valid()) return;
      this.stage = lease.stage;
      this.actor = new CharacterDriver(lease.stage, valid, this.scene.characterPresentation);
      const presentation = this.scene.createPresentation(lease, this.actor, this.state);
      this.presentation = presentation;
      if (connect || (!this.state.connected && !this.state.sessionExpired))
        await this.controller.connect();
      if (!valid()) return;
      await presentation.restore(this.state.story, this.state.environment, signal);
      await this.selectCharacter(this.characterId);
      if (!valid()) return;
      lease.stage.currentApp?.view.addEventListener(
        'webglcontextlost',
        (event: Event) => {
          if (!valid()) return;
          event.preventDefault();
          this.controller.interrupt();
          this.state.animation = 'suspended';
          this.state.failure = '舞台显示中断，请重建舞台后继续。';
        },
        { signal },
      );
    } catch (error) {
      if (valid()) {
        if (document.hidden) {
          this.state.animation = 'suspended';
          this.state.failure = '';
          return;
        }
        this.characterError = error instanceof Error ? error.message : 'STAGE_FAILED';
        this.state.animation = 'failed';
        this.state.failure = '舞台暂时无法就绪，请重建舞台后重试。';
      }
    }
  }
  async rebuildStage() {
    if (this.disposed) return;
    ++this.stageAttempt;
    this.controller.interrupt();
    this.characterLoad.abort();
    this.stageLifetime.abort();
    this.presentation?.dispose();
    this.actor?.dispose();
    this.presentation = undefined;
    this.actor = undefined;
    this.stage = undefined;
    this.engine.dispose();
    this.engine = createInteractiveEngine(this.scene.assets);
    this.stageLifetime = new AbortController();
    this.state.animation = 'loading';
    this.state.failure = '';
    await this.mountStage(false);
  }
  async selectCharacter(id: CharacterId) {
    if (!this.scene.characters.includes(id)) throw new Error('SCENE_CHARACTER_NOT_ALLOWED');
    const actor = this.actor;
    if (!actor || this.disposed) return;
    this.controller.interrupt();
    this.characterLoad.abort();
    this.characterLoad = new AbortController();
    const attempt = this.characterLoad;
    this.characterError = '';
    this.state.animation = 'loading';
    try {
      await actor.select(id, attempt.signal);
      if (attempt !== this.characterLoad || this.disposed) return;
      this.characterId = id;
      this.state.animation = 'live2d';
    } catch (error) {
      if (attempt !== this.characterLoad || attempt.signal.aborted || this.disposed) return;
      this.characterError = error instanceof Error ? error.message : '模型加载失败';
      this.state.animation = 'failed';
    }
  }
  private restoreProjection() {
    if (this.restoreQueued || !this.presentation || this.disposed) return;
    this.restoreQueued = true;
    queueMicrotask(() => {
      this.restoreQueued = false;
      if (!this.presentation || this.disposed) return;
      const presentation = this.presentation;
      const lifetime = this.stageLifetime;
      void presentation
        .restore(this.state.story, this.state.environment, lifetime.signal)
        .catch((error) => {
          if (
            !this.disposed &&
            !lifetime.signal.aborted &&
            lifetime === this.stageLifetime &&
            presentation === this.presentation &&
            !(error instanceof DOMException && error.name === 'AbortError')
          )
            this.state.failure = '场景恢复失败，可以重新连接或重建舞台。';
        });
    });
  }
  point(x: number, y: number): { left: string; top: string } {
    const p = this.stage?.mainStageContainer.toGlobal(new Point(x, y));
    return p ? { left: `${p.x}px`, top: `${p.y}px` } : { left: '50%', top: '50%' };
  }
  reconnect() {
    this.monitor.retry();
    void this.controller.recoverConnection(true, true);
  }
  newStory() {
    this.controller.interrupt();
    void this.controller.connect(true);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    ++this.stageAttempt;
    this.lifetime.abort();
    this.stageLifetime.abort();
    this.characterLoad.abort();
    this.monitor.dispose();
    void this.controller.dispose();
    this.presentation?.dispose();
    this.actor?.dispose();
    this.engine.dispose();
    this.listeners.clear();
  }
}
