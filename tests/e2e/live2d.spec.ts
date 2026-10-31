import { createHash } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window {
    __live2dProbe: {
      draws: number;
      sampleBudget: number;
      opaqueSamples: number;
      colors: string[];
      audioSamples: number;
      maximumRms: number;
    };
  }
}

async function observeNativeRendering(page: Page) {
  await page.addInitScript(() => {
    const probe = {
      draws: 0,
      sampleBudget: 0,
      opaqueSamples: 0,
      colors: [] as string[],
      audioSamples: 0,
      maximumRms: 0,
    };
    window.__live2dProbe = probe;
    const observe = (gl: WebGLRenderingContext | WebGL2RenderingContext) => {
      if (
        !(gl.canvas instanceof HTMLCanvasElement) ||
        !gl.canvas.classList.contains('live2d-canvas')
      )
        return;
      probe.draws += 1;
      if (probe.sampleBudget <= 0 || gl.isContextLost()) return;
      const point = probe.sampleBudget-- % 36;
      const x = Math.floor((((point % 6) + 0.5) * gl.drawingBufferWidth) / 6);
      const y = Math.floor(((Math.floor(point / 6) + 0.5) * gl.drawingBufferHeight) / 6);
      const pixel = new Uint8Array(4);
      // Read inside the actual draw call before a non-preserved framebuffer is cleared.
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      if ((pixel[3] ?? 0) > 0) {
        probe.opaqueSamples += 1;
        const color = Array.from(pixel).join(',');
        if (!probe.colors.includes(color)) probe.colors.push(color);
      }
    };
    for (const type of [WebGLRenderingContext, WebGL2RenderingContext]) {
      const nativeElements = type.prototype.drawElements;
      type.prototype.drawElements = function (mode, count, format, offset) {
        nativeElements.call(this, mode, count, format, offset);
        observe(this);
      };
      const nativeArrays = type.prototype.drawArrays;
      type.prototype.drawArrays = function (mode, first, count) {
        nativeArrays.call(this, mode, first, count);
        observe(this);
      };
    }
    const nativeSamples = AnalyserNode.prototype.getFloatTimeDomainData;
    AnalyserNode.prototype.getFloatTimeDomainData = function (samples) {
      nativeSamples.call(this, samples);
      probe.audioSamples += 1;
      const rms = Math.sqrt(
        samples.reduce((sum, value) => sum + value * value, 0) / samples.length,
      );
      probe.maximumRms = Math.max(probe.maximumRms, rms);
    };
  });
}

const character = (page: Page) => page.locator('.character-stage');
const canvas = (page: Page) => page.locator('canvas.live2d-canvas');
async function ready(page: Page) {
  await expect(character(page)).toHaveAttribute('data-renderer', 'live2d', { timeout: 20_000 });
  await expect(canvas(page)).toBeVisible();
  await expect(page.locator('#text-input')).toBeEnabled();
}
async function drawnPixels(page: Page) {
  await page.evaluate(() => {
    window.__live2dProbe.sampleBudget = 128;
    window.__live2dProbe.opaqueSamples = 0;
    window.__live2dProbe.colors = [];
  });
  await expect
    .poll(() => page.evaluate(() => window.__live2dProbe.opaqueSamples), { timeout: 10_000 })
    .toBeGreaterThan(4);
  await expect
    .poll(() => page.evaluate(() => window.__live2dProbe.colors.length))
    .toBeGreaterThan(3);
}
async function send(page: Page, text: string) {
  await page.locator('#text-input').fill(text);
  await page.getByRole('button', { name: '发送文字', exact: true }).click();
}
async function quietFrame(page: Page) {
  const before = await page.evaluate(() => window.__live2dProbe.draws);
  await expect
    .poll(() => page.evaluate(() => window.__live2dProbe.draws))
    .toBeGreaterThan(before + 2);
  return createHash('sha256')
    .update(await canvas(page).screenshot())
    .digest('hex');
}

test('default character draws real local Live2D textures, changes expressions and follows actual audio', async ({
  page,
}) => {
  await observeNativeRendering(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/');
  await ready(page);
  await drawnPixels(page);
  await expect(page.locator('svg.scene-art, canvas.rive-canvas')).toHaveCount(0);
  expect(requests.some((url) => url.includes('/haru/Haru.moc3'))).toBe(true);
  expect(requests.some((url) => url.includes('texture_00.png'))).toBe(true);
  expect(requests.some((url) => url.includes('texture_01.png'))).toBe(true);
  expect(
    requests.filter((url) => {
      const parsed = new URL(url);
      return (
        ['http:', 'https:'].includes(parsed.protocol) &&
        !['localhost', '127.0.0.1'].includes(parsed.hostname)
      );
    }),
  ).toEqual([]);

  const expressions: string[] = [];
  for (const [text, emotion] of [
    ['你在等谁？', 'guarded'],
    ['我喜欢旅行', 'curious'],
    ['谢谢你，我陪你坐一会儿', 'relieved'],
  ] as const) {
    await page.evaluate(() => {
      window.__live2dProbe.maximumRms = 0;
    });
    await send(page, text);
    await expect(page.locator('main')).toHaveAttribute('data-state', 'speaking');
    await expect(page.locator('main')).toHaveAttribute('data-emotion', emotion);
    await expect
      .poll(() => page.evaluate(() => window.__live2dProbe.maximumRms))
      .toBeGreaterThan(0.01);
    await page.getByRole('button', { name: '打断', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('data-state', 'idle');
    await expect(page.locator('main')).toHaveAttribute('data-action', 'none');
    const audioCalls = await page.evaluate(() => window.__live2dProbe.audioSamples);
    expressions.push(await quietFrame(page));
    expect(await page.evaluate(() => window.__live2dProbe.audioSamples)).toBe(audioCalls);
  }
  // With decorative motion disabled, the actual canvas raster differs for all three expressions.
  expect(new Set(expressions).size).toBe(3);
});

test('model download failure and actual WebGL context loss recover without the removed SVG character', async ({
  page,
}) => {
  await observeNativeRendering(page);
  await page.route('**/assets/live2d/haru/Haru.moc3', (route) => route.abort());
  await page.goto('/');
  await expect(character(page)).toHaveAttribute('data-renderer', 'failed', { timeout: 20_000 });
  await expect(page.locator('#text-input')).toBeEnabled();
  await expect(page.locator('svg.scene-art, canvas.rive-canvas')).toHaveCount(0);
  await send(page, '你好');
  await expect(page.locator('main')).toHaveAttribute('data-state', 'speaking');
  await page.getByRole('button', { name: '打断', exact: true }).click();
  await page.unroute('**/assets/live2d/haru/Haru.moc3');
  await page.getByRole('button', { name: '重新加载角色', exact: true }).click();
  await ready(page);
  await drawnPixels(page);

  const lost = await canvas(page).evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error('Expected canvas');
    const gl = element.getContext('webgl2') || element.getContext('webgl');
    const extension = gl?.getExtension('WEBGL_lose_context');
    if (!extension) return false;
    extension.loseContext();
    return true;
  });
  expect(lost).toBe(true);
  await expect(character(page)).toHaveAttribute('data-renderer', 'failed');
  await expect(page.locator('#text-input')).toBeEnabled();
  await page.getByRole('button', { name: '重新加载角色', exact: true }).click();
  await ready(page);
  await drawnPixels(page);
});

test('a hidden page cancels an unfinished model load, then restores only the new renderer', async ({
  page,
}) => {
  await observeNativeRendering(page);
  let releaseFirst: () => void = () => undefined;
  let observedFirst: () => void = () => undefined;
  let firstEnded: () => void = () => undefined;
  const release = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const observed = new Promise<void>((resolve) => {
    observedFirst = resolve;
  });
  const ended = new Promise<void>((resolve) => {
    firstEnded = resolve;
  });
  let modelRequests = 0;
  await page.route('**/assets/live2d/haru/Haru.moc3', async (route) => {
    modelRequests += 1;
    if (modelRequests === 1) {
      observedFirst();
      await release;
      // The original browser request has already been aborted by the hidden-page owner.
      await route.continue().catch(() => undefined);
      firstEnded();
    } else await route.continue();
  });
  try {
    await page.goto('/');
    await observed;
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(character(page)).toHaveAttribute('data-renderer', 'suspended');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await ready(page);
    await drawnPixels(page);
    expect(modelRequests).toBe(2);
    releaseFirst();
    await ended;
    await quietFrame(page);
    await expect(character(page)).toHaveAttribute('data-renderer', 'live2d');
    await expect(canvas(page)).toHaveCount(1);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(character(page)).toHaveAttribute('data-renderer', 'suspended');
    const stoppedAt = await page.evaluate(() => window.__live2dProbe.draws);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(await page.evaluate(() => window.__live2dProbe.draws)).toBe(stoppedAt);
  } finally {
    releaseFirst();
  }
});

test.describe('bounded high-DPR rendering', () => {
  test.use({ deviceScaleFactor: 3 });
  test('high-DPR Live2D preserves mobile controls and bounds its backing canvas', async ({
    page,
  }) => {
    await observeNativeRendering(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await ready(page);
    for (const size of [
      { width: 320, height: 740 },
      { width: 390, height: 844 },
      { width: 1440, height: 1000 },
    ]) {
      await page.setViewportSize(size);
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(size.width);
      expect(await page.evaluate(() => window.devicePixelRatio)).toBe(3);
      await expect(
        page.getByRole('button', { name: '切换语音输入', exact: true }),
      ).toBeInViewport();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
        .toBe(true);
      await expect
        .poll(() =>
          canvas(page).evaluate((element) => {
            if (!(element instanceof HTMLCanvasElement)) return Infinity;
            return element.width / element.getBoundingClientRect().width;
          }),
        )
        .toBeLessThanOrEqual(1.51);
      await drawnPixels(page);
      await quietFrame(page);
      await page.screenshot({
        path: `outputs/acceptance/live2d/viewport-${size.width}.png`,
        fullPage: true,
        scale: 'css',
      });
    }
  });
});
