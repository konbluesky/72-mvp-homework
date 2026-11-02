import { expect, test, type Page } from '@playwright/test';

// Source only during implementation. Execute only after explicit user authorization.
async function location(page: Page, label: string) {
  await page.getByRole('button', { name: '故事菜单', exact: true }).click();
  await page.getByRole('button', { name: '去别处看看', exact: true }).click();
  const destination = page
    .locator('.story-dialog[open]')
    .getByRole('button', { name: label, exact: true });
  await expect(destination).toBeEnabled({ timeout: 25000 });
  await destination.click();
}
async function enter(page: Page) {
  await page.goto('/');
  await expect(page.locator('.stage-loading')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '入口大堂', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '和米拉说话', exact: true })).toBeVisible();
}
async function appearance(page: Page) {
  await page.getByRole('button', { name: '故事菜单', exact: true }).click();
  const settings = page.locator('.menu-section').filter({ hasText: '外观与连接' });
  if ((await settings.getAttribute('open')) === null) await settings.locator('summary').click();
  return page.getByRole('combobox', { name: '角色外观', exact: true });
}

test('persistent conversation sends a suggestion as player speech from voice mode', async ({
  page,
}) => {
  await enter(page);
  const reply = page.getByRole('button', { name: '你是在等什么人吗？', exact: true });
  await expect(reply).toBeVisible();
  await page.getByRole('button', { name: '切换语音输入', exact: true }).click();
  await expect(reply).toBeVisible();
  await reply.click();
  await expect(page.locator('.chat-user')).toHaveText('你是在等什么人吗？');
  await expect(page.getByRole('button', { name: '切换文字输入', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '持续对话', exact: true })).toBeVisible();
});

test('independent WebGAL story preserves independent letters and supports departure without a photo', async ({
  page,
}) => {
  await enter(page);
  await expect(page.locator('canvas')).toHaveCount(1);
  await location(page, '去吧台看看');
  await expect(page.getByRole('heading', { name: '吧台结账台', exact: true })).toBeVisible();
  await expect(page.locator('.readable-document')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '观察场景', exact: true })).toBeEnabled({
    timeout: 25000,
  });
  await page.getByRole('button', { name: '观察场景', exact: true }).click();
  await page.getByRole('button', { name: '问她能否打开信', exact: true }).click();
  await expect(page.getByRole('button', { name: '阅读文字', exact: true })).toBeVisible({
    timeout: 25000,
  });
  await page.getByRole('button', { name: '阅读文字', exact: true }).click();
  await expect(page.locator('.readable-document')).toContainText('我下午来过');
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  await page
    .getByRole('textbox', { name: '和米拉说话', exact: true })
    .fill('好，我们一起出去走走吧。');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('heading', { name: '店外街道', exact: true })).toBeVisible({
    timeout: 25000,
  });
  await expect(page.getByRole('log', { name: '近期对话' })).toContainText('下一站，由我决定');
  await expect(page.locator('canvas')).toHaveCount(1);
});

test('Haru is the default and explicit Miara selection keeps the current place', async ({
  page,
}) => {
  await enter(page);
  const selector = await appearance(page);
  await expect(selector).toHaveValue('haru');
  await selector.selectOption('miara');
  await expect(page.locator('.stage-loading')).toHaveCount(0);
  await expect(selector).toHaveValue('miara');
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  await expect(page.getByRole('heading', { name: '入口大堂', exact: true })).toBeVisible();
});

test('initial Haru load failure never silently switches to Miara', async ({ page }) => {
  await page.route('**/assets/live2d/haru/**', (route) => route.abort());
  await page.goto('/webgal.html');
  await expect(page.locator('.stage-loading')).toContainText('角色加载失败', { timeout: 20000 });
  const selector = await appearance(page);
  await expect(selector).toHaveValue('haru');
  await selector.selectOption('miara');
  await expect(page.locator('.stage-loading')).toHaveCount(0);
  await expect(selector).toHaveValue('miara');
});

test('stage reconstruction preserves the confirmed place without replaying dialogue', async ({
  page,
}) => {
  await enter(page);
  await location(page, '去吧台看看');
  await expect(page.getByRole('heading', { name: '吧台结账台', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '故事菜单', exact: true }).click();
  await page.locator('.integration-details > summary').click();
  await page
    .locator('.integration-details')
    .getByRole('button', { name: '重建舞台', exact: true })
    .click();
  await expect(page.locator('.stage-loading')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '吧台结账台', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '停止当前演出', exact: true })).toHaveCount(0);
  await expect(page.locator('canvas')).toHaveCount(1);
});
