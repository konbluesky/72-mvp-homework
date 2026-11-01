import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { createApp } from '../../apps/server/src/app.js';
import { createLiveProviders } from '../../apps/server/src/providers/index.js';
import { testConfig, testMedia } from '../../apps/server/test/helpers.js';
import { MOCK_LINES } from '../../apps/server/src/scenario/cafe/mock.js';
import { plannerResponse, transcriptResponse } from '../fixtures/provider-http.js';
import type { Fetch } from '../../apps/server/src/providers/http.js';

test('real recorder to Deepgram STT adapter, GPT graph, Deepgram TTS adapter and actual browser playback', async ({
  page,
}) => {
  const config = testConfig({
    APP_MODE: 'live',
    GPT_BASE_URL: 'https://gpt.example/v1',
    GPT_API_KEY: 'test-gpt',
    GPT_MODEL: 'test-model',
    DEEPGRAM_API_KEY: 'test-deepgram',
    DEEPGRAM_MODEL: 'flux-lijuan-zh',
  });
  const mp3 = execFileSync(
    config.FFMPEG_PATH,
    [
      '-v',
      'error',
      '-i',
      fileURLToPath(new URL('../../assets/mock-audio/hello.wav', import.meta.url)),
      '-f',
      'mp3',
      'pipe:1',
    ],
    { maxBuffer: 1048576, timeout: 5000 },
  );
  const stages: string[] = [];
  const fetcher: Fetch = async (url, request) => {
    const path = new URL(String(url)).pathname;
    if (path === '/v1/listen') {
      stages.push('stt');
      expect(request?.headers).toMatchObject({
        Authorization: 'Token test-deepgram',
        'Content-Type': 'audio/wav',
      });
      expect(request?.body).toBeInstanceOf(Buffer);
      if (!(request?.body instanceof Buffer)) throw new Error('Expected normalized WAV');
      expect(request.body.subarray(0, 4).toString()).toBe('RIFF');
      return Response.json(transcriptResponse('能看看照片吗？'));
    }
    if (path === '/v1/chat/completions') {
      stages.push('planner');
      return plannerResponse({
        suggestions: [],
        segments: [
          {
            text: MOCK_LINES.hello,
            emotion: 'relieved',
            action: 'offerPhoto',
            events: [{ type: 'photo', resourceId: 'travel_photo_01' }],
          },
        ],
      });
    }
    if (path === '/v2/speak') {
      stages.push('tts');
      expect(JSON.parse(String(request?.body))).toEqual({ text: MOCK_LINES.hello });
      return new Response(new Uint8Array(mp3), {
        headers: { 'Content-Type': 'audio/mpeg', 'dg-request-id': 'tts-fixture' },
      });
    }
    throw new Error('Uncontrolled provider request');
  };
  const app = await createApp({
    config,
    providers: createLiveProviders(config, fetcher),
    media: testMedia(config),
    logger: false,
  });
  try {
    const api = await app.listen({ port: 0, host: '127.0.0.1' });
    await page.route(
      (url) => url.pathname.startsWith('/api/'),
      async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        const response = await route.fetch({ url: `${api}${path}` });
        await route.fulfill({ response });
      },
    );
    await page.goto('/legacy.html');
    await expect(page.locator('#text-input')).toBeEnabled();
    await page.getByRole('button', { name: '切换语音输入', exact: true }).click();
    const hold = page.getByRole('button', { name: '按住录音，松开预览，上滑取消' });
    await expect(hold).toBeEnabled();
    await hold.focus();
    await page.keyboard.down('Space');
    await expect(page.locator('main')).toHaveAttribute('data-state', 'listening');
    // Actual capture interval, not a readiness wait.
    await page.waitForTimeout(650);
    await page.keyboard.up('Space');
    await expect(page.getByRole('textbox', { name: '编辑语音消息' })).toHaveValue('能看看照片吗？');
    expect(stages).toEqual(['stt']);
    await expect(page.locator('.recent-user')).toHaveCount(0);
    await page
      .getByRole('textbox', { name: '编辑语音消息' })
      .fill('能看看照片吗？我想听听那次旅行。');
    await page.getByRole('button', { name: '确认发送', exact: true }).click();
    await expect(page.locator('.recent-user').last()).toContainText('能看看照片吗？');
    await expect(page.locator('main')).toHaveAttribute('data-state', 'speaking');
    await expect(page.locator('.subtitle')).toContainText(MOCK_LINES.hello);
    await expect(page.locator('[data-photo]')).toBeVisible();
    expect(stages).toEqual(['stt', 'planner', 'tts']);
    await page.getByRole('button', { name: '停止当前回复', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('data-state', 'idle');
  } finally {
    await app.close();
  }
});
