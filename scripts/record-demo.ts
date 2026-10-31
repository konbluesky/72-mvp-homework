import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const directory = process.env.DEMO_OUTPUT_DIR || 'outputs/acceptance/live2d/demo';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  recordVideo: { dir: directory, size: { width: 1280, height: 900 } },
  permissions: ['microphone'],
});
const page = await context.newPage();
const started = Date.now();
const at = async (seconds: number) => {
  const wait = seconds * 1000 - (Date.now() - started);
  if (wait > 0) await page.waitForTimeout(wait);
};
const note = async (text: string) =>
  page.evaluate((text) => {
    let element = document.getElementById('demo-caption');
    if (!element) {
      element = document.createElement('aside');
      element.id = 'demo-caption';
      element.style.cssText =
        'position:fixed;z-index:999;left:24px;top:86px;max-width:390px;background:#0b2028e8;color:#f1dfbc;padding:14px 18px;border:1px solid #ccb984;border-radius:12px;font:15px/1.7 sans-serif;pointer-events:none;white-space:pre-line';
      document.body.append(element);
    }
    element.textContent = text;
  }, text);
const send = async (text: string) => {
  if (!(await page.locator('#text-input').isVisible()))
    await page.getByRole('button', { name: '切换文字输入', exact: true }).click();
  await page.locator('#text-input').fill(text);
  await page.getByRole('button', { name: '发送文字', exact: true }).click();
};
const idle = () =>
  expect(page.locator('main')).toHaveAttribute('data-playback', 'idle', { timeout: 20000 });
try {
  await page.goto(process.env.DEMO_URL || 'http://127.0.0.1:5173');
  await expect(page.locator('#text-input')).toBeEnabled();
  await expect(page.locator('.character-stage')).toHaveAttribute('data-renderer', 'live2d', {
    timeout: 20000,
  });
  await note(
    '雨停之前 · 自动化演示\nMock 后端 / 本地合成语音 / Live2D / Haru 官方技术替身\n录像不含系统声音，麦克风使用测试设备。',
  );
  await at(8);
  await page.getByRole('button', { name: '更多：场景、使用说明与素材来源' }).click();
  await at(18);
  await page.getByRole('button', { name: '关闭场景说明' }).click();
  await note(
    '01 文字互动与角色状态\n“你在等谁？” → 思考、说话、戒备、望窗\n字幕跟随实际 Web Audio 播放。',
  );
  await send('你在等谁？');
  await idle();
  await at(35);
  await note('02 三种情绪\n旅行话题 → 好奇；安慰 → 释然\n角色眉眼、嘴部和局部姿态共同变化。');
  await send('我喜欢旅行');
  await idle();
  await at(48);
  await send('谢谢你，我陪你坐一会儿');
  await idle();
  await at(63);
  await note('03 对话触发的多模态\n请求照片 → 分享照片 → 图片可见回执\n照片确认后雨势才减弱。');
  await send('能看看照片吗？');
  await expect(page.locator('[data-photo]')).toBeVisible();
  await idle();
  await at(84);
  await note('04 连续剧情与拒绝\n“不要看照片”不会再触发照片。\n已确认的雨势与剧情保留。');
  await send('不要看照片');
  await idle();
  await at(99);
  await note(
    '05 语音打断\n先开始一句回复，再按住麦克风立即停声。\n真实录制上传，Mock 明示模拟识别示例。',
  );
  await send('你在等谁？');
  await expect(page.locator('main')).toHaveAttribute('data-state', 'speaking');
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: '切换语音输入', exact: true }).click();
  await page.getByRole('button', { name: '按住录音，松开发送，上滑取消' }).focus();
  await page.keyboard.down('Space');
  await expect(page.locator('main')).toHaveAttribute('data-state', 'listening');
  await page.waitForTimeout(1000);
  await page.keyboard.up('Space');
  await expect(page.locator('.recent-user')).toContainText('语音示例');
  await idle();
  await at(123);
  await note(
    '06 声音失败恢复（测试注入）\n阻断音频下载，选择“用字幕继续”。\n每句需要明确确认，不假装发声。',
  );
  await page.route('**/api/media/*', (route) => route.abort());
  await send('你好');
  await expect(page.getByRole('button', { name: '阅读文字' })).toBeVisible();
  await page.waitForTimeout(3500);
  await page.getByRole('button', { name: '阅读文字' }).click();
  await page.waitForTimeout(5000);
  await page.getByRole('button', { name: '下一句', exact: false }).click();
  await idle();
  await page.unroute('**/api/media/*');
  await at(145);
  await note('07 照片失败恢复（测试注入）\n图片无法加载仍可继续对话。\n失败事件不伪装成成功呈现。');
  await page.route('**/assets/travel-photo.svg', (route) => route.abort());
  await send('能看看照片吗？');
  await expect(page.getByRole('alert')).toContainText('照片暂时打不开');
  await idle();
  await at(164);
  await page.unroute('**/assets/travel-photo.svg');
  await page.getByRole('button', { name: '继续对话', exact: true }).click();
  await note(
    '08 恢复并继续\n新一轮仍然可用，旧轮不会复活。\nLive 凭证、原创 Mira 模型 与真机听感待验证。',
  );
  await send('谢谢你');
  await idle();
  await at(186);
  const video = page.video();
  await context.close();
  if (!video) throw new Error('Video missing');
  await video.saveAs(`${directory}/mira-demo.webm`);
  process.stdout.write(
    `Recorded ${Math.round((Date.now() - started) / 1000)} seconds: ${directory}/mira-demo.webm\n`,
  );
} finally {
  await browser.close();
}
