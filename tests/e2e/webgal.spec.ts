import { expect, test, type Page } from '@playwright/test';

interface PreviewStage {
  currentApp: unknown;
  stageAnimations: unknown[];
  backgroundObjects: unknown[];
  getStageObjByKey(key: string): { pixiContainer: { scale: { x: number } } } | undefined;
  foregroundEffectsContainer: { children: { destroyed: boolean }[] };
  assets: {
    renderer?: unknown;
    ensureReady(request: { url: string }): Promise<unknown>;
  };
}
interface PreviewApplication {
  stage: unknown;
}
interface PreviewWindow extends Window {
  PIXIapp: PreviewStage;
  __PIXI_APP__: PreviewApplication;
  __previewOld?: { stage: PreviewStage; app: PreviewApplication; rain: { destroyed: boolean } };
  __previewGate?: {
    blocked: boolean;
    once: boolean;
    original: PreviewStage['assets']['ensureReady'];
    prototype: PreviewStage['assets'];
    release?: () => void;
    oldStage?: PreviewStage;
  };
}

async function ready(page: Page) {
  await expect(page.locator('main')).toHaveAttribute('data-preview-state', 'ready');
  await expect(page.locator('canvas')).toHaveCount(1);
}

test('native scene switches retire rain tickers and camera changes the engine object', async ({
  page,
}) => {
  const api: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) api.push(request.url());
  });
  await page.goto('/webgal.html?preview=1');
  await ready(page);
  await expect(page.locator('[data-evidence=particles]')).toHaveText('200');
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: '雨后的傍晚', exact: true }).click();
    await expect(page.locator('[data-evidence=particles]')).toHaveText('0');
    expect(
      await page.evaluate(
        () => (window as unknown as PreviewWindow).PIXIapp.stageAnimations.length,
      ),
    ).toBe(0);
    await page.getByRole('button', { name: '雨夜咖啡馆', exact: true }).click();
    await expect(page.locator('[data-evidence=particles]')).toHaveText('200');
    expect(
      await page.evaluate(
        () => (window as unknown as PreviewWindow).PIXIapp.stageAnimations.length,
      ),
    ).toBe(2);
    await ready(page);
    await expect(page.locator('[data-evidence=backgrounds]')).toHaveText('1');
  }
  await page.getByRole('button', { name: '放大视角', exact: true }).click();
  await expect(page.locator('[data-evidence=zoom]')).toHaveText('112%');
  expect(
    await page.evaluate(
      () =>
        (window as unknown as PreviewWindow).PIXIapp.getStageObjByKey('bg-main')!.pixiContainer
          .scale.x,
    ),
  ).toBe(1.12);
  await page.getByRole('button', { name: '还原视角', exact: true }).click();
  await expect(page.locator('[data-evidence=zoom]')).toHaveText('100%');
  expect(api).toEqual([]);
});

test('rebuild destroys the old rain layer and detaches its renderer', async ({ page }) => {
  await page.goto('/webgal.html?preview=1');
  await ready(page);
  const epoch = await page.locator('[data-evidence=epoch]').textContent();
  await page.evaluate(() => {
    const scope = window as unknown as PreviewWindow;
    scope.__previewOld = {
      stage: scope.PIXIapp,
      app: scope.__PIXI_APP__,
      rain: scope.PIXIapp.foregroundEffectsContainer.children[0]!,
    };
  });
  await page.getByRole('button', { name: '重新创建舞台' }).click();
  await ready(page);
  await expect(page.locator('[data-evidence=epoch]')).not.toHaveText(epoch!);
  expect(
    await page.evaluate(() => {
      const { stage, app, rain } = (window as unknown as PreviewWindow).__previewOld!;
      return {
        app: stage.currentApp,
        rendererDetached: stage.assets.renderer === undefined,
        animations: stage.stageAnimations.length,
        destroyed: app.stage === null,
        rainDestroyed: rain.destroyed,
      };
    }),
  ).toEqual({
    app: null,
    rendererDetached: true,
    animations: 0,
    destroyed: true,
    rainDestroyed: true,
  });
  await expect(page.locator('[data-evidence=particles]')).toHaveText('200');
});

test('a prepared texture from an obsolete stage cannot mount after a newer rebuild', async ({
  page,
}) => {
  await page.goto('/webgal.html?preview=1');
  await ready(page);
  await page.evaluate(() => {
    const scope = window as unknown as PreviewWindow;
    const prototype = Object.getPrototypeOf(scope.PIXIapp.assets) as PreviewStage['assets'];
    const original = prototype.ensureReady;
    const gate = { blocked: false, once: true, prototype, original } as NonNullable<
      PreviewWindow['__previewGate']
    >;
    scope.__previewGate = gate;
    prototype.ensureReady = function (request) {
      const operation = original.call(this, request);
      if (gate.once && request.url.endsWith('cafe-night.svg')) {
        gate.once = false;
        return operation.then(
          (texture) =>
            new Promise((resolve) => {
              gate.release = () => resolve(texture);
              gate.blocked = true;
            }),
        );
      }
      return operation;
    };
  });
  await page.getByRole('button', { name: '重新创建舞台' }).click();
  await page.waitForFunction(() => (window as unknown as PreviewWindow).__previewGate?.blocked);
  await page.evaluate(() => {
    const scope = window as unknown as PreviewWindow;
    scope.__previewGate!.oldStage = scope.PIXIapp;
  });
  await page.getByRole('button', { name: '重新创建舞台' }).click();
  await ready(page);
  const epoch = await page.locator('[data-evidence=epoch]').textContent();
  const result = await page.evaluate(async () => {
    const scope = window as unknown as PreviewWindow;
    const gate = scope.__previewGate!;
    const latest = scope.PIXIapp;
    gate.prototype.ensureReady = gate.original;
    gate.release!();
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    return {
      latestUnchanged: scope.PIXIapp === latest,
      retiredMountedBackgrounds: gate.oldStage!.backgroundObjects.length,
      retiredApplication: gate.oldStage!.currentApp,
      retiredRendererDetached: gate.oldStage!.assets.renderer === undefined,
    };
  });
  expect(result).toEqual({
    latestUnchanged: true,
    retiredMountedBackgrounds: 0,
    retiredApplication: null,
    retiredRendererDetached: true,
  });
  await expect(page.locator('[data-evidence=epoch]')).toHaveText(epoch!);
  await expect(page.locator('[data-evidence=particles]')).toHaveText('200');
  await ready(page);
});
