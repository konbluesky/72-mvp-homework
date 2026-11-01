import { drawCafeAmbience } from './locations/foreground.js';
import { abortable } from '../../../playback/abortable.js';
import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { projectStory, type PresentationEvent, type StoryState } from '@mira/protocol';
import type { PresentationPort } from '../../../playback/scheduler.js';
import type { InteractiveState } from '../../../interaction/state.js';
import type { VisualEngineLease } from '../../runtime/engine-adapter';
import { CharacterDriver } from '../../characters/driver';
import { cafeLocation, cafeResource, stageScene } from './definition';

type Scope = { revision: number; abort: AbortController };
export class CafePresentation implements PresentationPort {
  private revision = 0;
  private scope?: Scope;
  private disposed = false;
  private initialized = false;
  private previewActive = false;
  private documentOpen = false;
  private story: StoryState;
  private weather: string;
  private paper = new Container();
  private scenery = new Graphics();
  private transitions = new Map<string, Graphics>();
  constructor(
    private lease: VisualEngineLease,
    private actor: CharacterDriver,
    private store: InteractiveState,
  ) {
    this.story = store.story;
    this.weather = store.environment;
    lease.stage.foregroundEffectsContainer.addChild(this.scenery, this.paper);
  }
  private valid(scope: Scope, signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.disposed || scope.revision !== this.revision || !this.lease.stage.currentApp)
      throw new DOMException('Stage superseded', 'AbortError');
  }
  private begin(ownerSignal: AbortSignal): { scope: Scope; signal: AbortSignal } {
    this.scope?.abort.abort();
    const scope = { revision: ++this.revision, abort: new AbortController() };
    this.scope = scope;
    return {
      scope,
      signal: AbortSignal.any([ownerSignal, scope.abort.signal, AbortSignal.timeout(12000)]),
    };
  }
  private async painted(scope: Scope, signal: AbortSignal) {
    for (let i = 0; i < 2; i++)
      await new Promise<void>((resolve, reject) => {
        this.valid(scope, signal);
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
    this.valid(scope, signal);
    const app = this.lease.stage.currentApp;
    if (
      document.hidden ||
      !app ||
      ('context' in app.renderer && app.renderer.context.isLost) ||
      app.view.getBoundingClientRect().width < 1
    )
      throw new Error('STAGE_NOT_VISIBLE');
    app.render();
  }
  private async fade(scope: Scope, signal: AbortSignal, from: number, to: number) {
    this.valid(scope, signal);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const stage = this.lease.stage;
    const overlay = new Graphics().beginFill(0x10282e).drawRect(0, 0, 2560, 1440).endFill();
    overlay.alpha = from;
    stage.foregroundEffectsContainer.addChild(overlay);
    const key = `transition-${scope.revision}-${crypto.randomUUID()}`;
    this.transitions.set(key, overlay);
    await new Promise<void>((resolve, reject) => {
      const start = performance.now();
      const cleanup = () => {
        signal.removeEventListener('abort', abort);
        stage.removeAnimationWithoutSetEndState(key);
        this.transitions.delete(key);
        overlay.destroy();
      };
      const abort = () => {
        cleanup();
        reject(signal.reason);
      };
      signal.addEventListener('abort', abort, { once: true });
      stage.registerAnimation(
        {
          setStartState() {},
          setEndState() {},
          tickerFunc: () => {
            try {
              this.valid(scope, signal);
            } catch (error) {
              cleanup();
              reject(error);
              return;
            }
            const fraction = Math.min(1, (performance.now() - start) / 170);
            overlay.alpha = from + (to - from) * fraction;
            if (fraction >= 1) {
              cleanup();
              resolve();
            }
          },
        },
        key,
      );
    });
  }
  private furniture(story: StoryState) {
    this.scenery.clear();
    const location = cafeLocation(story.location);
    if (location.foreground) location.foreground(this.scenery, story);
    else drawCafeAmbience(this.scenery, story);
    this.actor.layout({
      ...location,
      lookDirection: location.lookDirection ?? 0,
      x: this.documentOpen ? 2020 : location.x,
    });
  }
  async restore(story: StoryState, environment: string, ownerSignal: AbortSignal): Promise<void> {
    if (
      this.initialized &&
      this.weather === environment &&
      this.story.location === story.location &&
      this.story.ambience === story.ambience &&
      this.story.ending === story.ending &&
      this.story.revealed.join(',') === story.revealed.join(',')
    ) {
      this.story = story;
      return;
    }
    const { scope, signal } = this.begin(ownerSignal);
    await this.lease.visuals.present(stageScene(story, environment), signal);
    this.valid(scope, signal);
    this.story = story;
    this.weather = environment;
    this.furniture(story);
    await this.painted(scope, signal);
    this.initialized = true;
  }
  private async transition(next: StoryState, environment: string, ownerSignal: AbortSignal) {
    const previous = this.story,
      previousEnvironment = this.weather;
    const { scope, signal } = this.begin(ownerSignal);
    this.dismiss();
    try {
      await this.fade(scope, signal, 0, 0.45);
      await this.lease.visuals.present(stageScene(next, environment), signal);
      this.valid(scope, signal);
      this.furniture(next);
      await this.fade(scope, signal, 0.45, 0);
      await this.painted(scope, signal);
      this.story = next;
      this.weather = environment;
      this.store.story = next;
      this.store.environment = environment;
    } catch (error) {
      if (!this.disposed && scope.revision === this.revision && this.lease.stage.currentApp) {
        const rollback = ++this.revision;
        await this.lease.visuals
          .present(stageScene(previous, previousEnvironment))
          .catch(() => undefined);
        if (rollback === this.revision && !this.disposed) this.furniture(previous);
      }
      throw error;
    }
  }
  async execute(
    event: Exclude<PresentationEvent, { type: 'photo' | 'environment' }>,
    signal: AbortSignal,
  ) {
    if (event.type === 'prop') {
      const { scope, signal: local } = this.begin(signal);
      this.dismiss();
      const content = event.document;
      if (!content) throw new Error('DOCUMENT_NOT_AUTHORIZED');
      this.drawPaper(content.title, content.text);
      await this.painted(scope, local);
      this.story = projectStory(this.story, event);
      this.store.story = this.story;
      this.store.documentTitle = content.title;
      this.store.documentText = content.text;
      this.furniture(this.story);
    } else if (event.type === 'beat') {
      const { scope, signal: local } = this.begin(signal);
      await this.painted(scope, local);
    } else await this.transition(projectStory(this.story, event), this.weather, signal);
  }
  private drawPaper(title: string, body: string) {
    const bg = new Graphics()
      .beginFill(0x071f2b, 0.4)
      .drawRect(0, 0, 2560, 1440)
      .endFill()
      .beginFill(0xeee0bb)
      .drawRoundedRect(260, 190, 1260, 1020, 18)
      .endFill();
    const heading = new Text(title, { fontFamily: 'serif', fontSize: 64, fill: 0x3b4a42 });
    heading.position.set(350, 280);
    const text = new Text(body, {
      fontFamily: 'serif',
      fontSize: 43,
      lineHeight: 76,
      fill: 0x4b574c,
      wordWrap: true,
      wordWrapWidth: 1060,
      breakWords: true,
    });
    text.position.set(350, 420);
    this.paper.addChild(bg, heading, text);
    this.documentOpen = true;
    this.furniture(this.story);
  }
  async photo(event: Extract<PresentationEvent, { type: 'photo' }>, ownerSignal: AbortSignal) {
    const { scope, signal } = this.begin(ownerSignal);
    this.dismiss();
    const texture = await abortable(
      this.lease.stage.assets.ensureReady<Texture>({
        url: cafeResource(event.resourceId).url,
        kind: 'texture',
      }),
      signal,
    );
    this.valid(scope, signal);
    const sprite = new Sprite(texture);
    sprite.position.set(300, 300);
    sprite.width = 1250;
    sprite.height = 890;
    this.paper.addChild(sprite);
    this.documentOpen = true;
    this.furniture(this.story);
    await this.painted(scope, signal);
    this.store.photo = 'visible';
    this.store.documentTitle = '那年海边，天空很亮';
    this.store.documentText = '海岸风景：明亮的天空、蓝绿色海面与沿岸浪花。照片没有人物。';
  }
  environment(event: Extract<PresentationEvent, { type: 'environment' }>, signal: AbortSignal) {
    return this.transition(this.story, event.environment, signal);
  }
  dismiss() {
    for (const child of this.paper.removeChildren()) child.destroy({ children: true });
    this.store.photo = 'hidden';
    this.store.documentTitle = '';
    this.store.documentText = '';
    this.documentOpen = false;
    if (!this.disposed) this.furniture(this.story);
  }
  camera(action: string) {
    if (this.previewActive) return;
    const stage = this.lease.stage,
      app = stage.currentApp;
    if (!app) return;
    const zoom =
      action === 'lookWindow' &&
      cafeLocation(this.story.location).lookWindowCamera &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 1.08
        : 1;
    const scale = Math.max(app.screen.width / 2560, app.screen.height / 1440);
    stage.mainStageContainer.scale.set(scale * zoom);
  }
  async previewScene(zoom: number, weather: string, ownerSignal: AbortSignal) {
    if (!Number.isFinite(zoom) || zoom < 1 || zoom > 1.15) throw new Error('PREVIEW_ZOOM');
    const { scope, signal } = this.begin(ownerSignal);
    this.previewActive = true;
    await this.lease.visuals.present(stageScene(this.story, weather), signal);
    this.valid(scope, signal);
    const root = this.lease.stage.mainStageContainer;
    root.scale.set(root.scale.x * zoom);
    await this.painted(scope, signal);
  }
  previewMotion(group: string) {
    this.actor.previewOriginal(group);
  }
  clear() {
    this.scope?.abort.abort();
    if (this.previewActive && !this.disposed) {
      this.previewActive = false;
      void this.lease.visuals.present(stageScene(this.story, this.weather)).catch(() => undefined);
    }
    this.actor.stopPreview();
    this.dismiss();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    ++this.revision;
    for (const [key, overlay] of this.transitions) {
      this.lease.stage.removeAnimationWithoutSetEndState(key);
      overlay.destroy();
    }
    this.transitions.clear();
    this.scenery.destroy();
    this.paper.destroy({ children: true });
  }
}
