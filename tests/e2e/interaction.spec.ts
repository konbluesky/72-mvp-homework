import { test, expect, type Page } from '@playwright/test';
import { SessionCreatedSchema, SessionSnapshotSchema, type SessionCreated } from '@mira/protocol';

async function enter(page: Page): Promise<SessionCreated> {
  const session = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/sessions') && response.request().method() === 'POST',
  );
  await page.goto('/');
  const created = SessionCreatedSchema.parse(await (await session).json());
  await expect(page.locator('#text-input')).toBeEnabled();
  return created;
}
async function send(page: Page, text: string) {
  await page.locator('#text-input').fill(text);
  await page.getByRole('button', { name: '发送文字', exact: true }).click();
}
async function snapshot(page: Page, session: SessionCreated) {
  const result = await page.request.get(`/api/sessions/${session.sessionId}`, {
    headers: { Authorization: `Bearer ${session.sessionToken}` },
  });
  expect(result.ok()).toBeTruthy();
  return SessionSnapshotSchema.parse(await result.json());
}

test('advertised speech capability controls microphone independently of mode', async ({ page }) => {
  // Only advertise Live to the UI; the isolated server remains Mock and never calls paid services.
  await page.route('**/api/sessions', async (route) => {
    const response = await route.fetch();
    const session = SessionCreatedSchema.parse(await response.json());
    await route.fulfill({
      response,
      json: { ...session, mode: 'live', capabilities: { voiceInput: false } },
    });
  });
  await enter(page);
  await expect(page.getByRole('button', { name: '麦克风暂不可用，请输入文字' })).toBeDisabled();
  await expect(page.locator('#text-input')).toBeEnabled();
  await send(page, '你好');
  await expect(page.locator('main')).toHaveAttribute('data-state', 'speaking');
  await page.getByRole('button', { name: '暂停，换我说', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('data-state', 'idle');
});

test('real backend audio, photo receipts, interruption and continuous context', async ({
  page,
}) => {
  const external: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    // Live2D uses local blob/data URLs; those do not make external network requests.
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.hostname.match(/^(127\.0\.0\.1|localhost)$/)
    )
      external.push(request.url());
  });
  const session = await enter(page);
  await send(page, '你在等谁？');
  await expect(page.locator('main')).toHaveAttribute('data-state', 'speaking');
  await expect(page.locator('main')).toHaveAttribute('data-emotion', 'guarded');
  await expect(page.locator('main')).toHaveAttribute('data-action', 'lookWindow');
  await page.getByRole('button', { name: '暂停，换我说', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('data-state', 'idle');
  await expect(page.locator('main')).toHaveAttribute('data-action', 'none');
  expect(
    (await snapshot(page, session)).history.filter((x) => x.role === 'assistant'),
  ).toHaveLength(0);
  await send(page, '能看看照片吗？');
  await expect(page.locator('[data-photo]')).toBeVisible();
  await expect
    .poll(async () => (await snapshot(page, session)).scene.facts.photo_revealed)
    .toBe(true);
  await expect(page.locator('main')).toHaveAttribute('data-weather', 'rain-soft', {
    timeout: 20000,
  });
  await send(page, '不要看照片');
  await expect(page.locator('[data-photo]')).toHaveCount(0);
  await expect(page.locator('main')).toHaveAttribute('data-emotion', 'guarded');
  await expect(page.locator('.subtitle')).toContainText('不看照片');
  expect((await snapshot(page, session)).scene.facts.photo_revealed).toBe(true);
  expect(external).toEqual([]);
});

test('rapid three inputs cannot resurrect stale playback or block the newest begin', async ({
  page,
}) => {
  const session = await enter(page);
  await page.evaluate(() => {
    const input = document.querySelector<HTMLTextAreaElement>('#text-input');
    const form = input?.closest('form');
    if (!input || !form) throw new Error('input missing');
    for (const text of ['你在等谁？', '能看看照片吗？', '我喜欢旅行']) {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      form.requestSubmit();
    }
  });
  await expect(page.locator('main')).toHaveAttribute('data-state', 'speaking');
  await expect(page.locator('.subtitle')).toContainText('旅行');
  await expect(page.locator('main')).toHaveAttribute('data-emotion', 'curious');
  await expect(page.locator('[data-photo]')).toHaveCount(0);
  expect((await snapshot(page, session)).generation).toBe(3);
});

test('audio download failure uses explicit text acknowledgements', async ({ page }) => {
  const session = await enter(page);
  await page.route('**/api/media/*', (route) => route.abort());
  await send(page, '你好');
  await expect(page.getByRole('button', { name: '阅读文字' })).toBeVisible();
  await expect(page.locator('main')).toHaveAttribute('data-state', 'idle');
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: '阅读文字' }).click();
    await expect(page.locator('main')).toHaveAttribute('data-playback', 'text');
    await expect(page.locator('main')).toHaveAttribute('data-state', 'idle');
    await page.getByRole('button', { name: '下一句', exact: false }).click();
  }
  await expect(page.locator('main')).toHaveAttribute('data-playback', 'idle');
  await expect
    .poll(
      async () =>
        (await snapshot(page, session)).history.filter(
          (x) => x.role === 'assistant' && x.mode === 'text',
        ).length,
    )
    .toBe(2);
});

test('failed image never commits photo or its dependent weather', async ({ page }) => {
  const session = await enter(page);
  await page.route('**/assets/travel-photo.svg', (route) => route.abort());
  await send(page, '能看看照片吗？');
  await expect(page.getByRole('alert')).toContainText('照片暂时打不开');
  await expect(page.locator('main')).toHaveAttribute('data-state', 'idle', { timeout: 25000 });
  const state = await snapshot(page, session);
  expect(state.scene.facts).toEqual({ photo_revealed: false, rain_softened: false });
  await expect(page.locator('main')).toHaveAttribute('data-weather', 'rain');
});

test('actual MediaRecorder upload with fake microphone is explicitly simulated transcription', async ({
  page,
}) => {
  await enter(page);
  await page.getByRole('button', { name: '切换语音输入', exact: true }).click();
  const hold = page.getByRole('button', { name: '按住录音，松开发送，上滑取消' });
  await hold.focus();
  await page.keyboard.down('Space');
  await expect(page.locator('main')).toHaveAttribute('data-state', 'listening');
  // This measures a real recorder capture interval; not a readiness wait.
  await page.waitForTimeout(650);
  await page.keyboard.up('Space');
  await expect(page.locator('.recent-user')).toContainText('语音示例', { timeout: 15000 });
  await expect(page.locator('[data-photo]')).toBeVisible();
});

test('offline interruption stops playback and reconnects without replay', async ({
  page,
  context,
}) => {
  await enter(page);
  await send(page, '你好');
  await expect(page.locator('main')).toHaveAttribute('data-state', 'speaking');
  await context.setOffline(true);
  await expect(page.locator('main')).toHaveAttribute('data-state', 'idle');
  await expect(page.getByRole('alert')).toContainText('网络断开了');
  await context.setOffline(false);
  await page.getByRole('button', { name: '重新连接', exact: true }).click();
  await expect(page.locator('#text-input')).toBeEnabled();
  await send(page, '谢谢你');
  await expect(page.locator('.subtitle')).toContainText('谢谢你');
});

test('320px, 390px and desktop retain visible accessible input controls', async ({ page }) => {
  await enter(page);
  for (const viewport of [
    { width: 320, height: 740 },
    { width: 390, height: 844 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('#text-input')).toBeVisible();
    await expect(page.getByRole('button', { name: '切换语音输入', exact: true })).toBeInViewport();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const box = await page.getByRole('button', { name: '发送文字', exact: true }).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    await page.getByRole('button', { name: '切换语音输入', exact: true }).click();
    await expect(
      page.getByRole('button', { name: '按住录音，松开发送，上滑取消' }),
    ).toBeInViewport();
    await page.getByRole('button', { name: '切换文字输入', exact: true }).click();
    await page.screenshot({
      path: `outputs/acceptance/live2d/interaction-viewport-${viewport.width}.png`,
      fullPage: true,
    });
  }
});
