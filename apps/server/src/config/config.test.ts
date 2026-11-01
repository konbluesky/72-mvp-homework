import { describe, expect, it } from 'vitest';
import { isAbsolute } from 'node:path';
import { loadConfig, loadProbeConfig } from './index.js';

const liveTextConfig = {
  APP_MODE: 'live',
  GPT_BASE_URL: 'https://gpt.example/v1',
  GPT_API_KEY: 'test-gpt',
  GPT_MODEL: 'configured-model',
  DEEPGRAM_API_KEY: 'test-deepgram',
  DEEPGRAM_MODEL: 'flux-lijuan-zh',
};

describe('configuration boundaries', () => {
  it('disables demo frequency quotas by default while retaining production limits and explicit overrides', () => {
    expect(loadConfig({}).RATE_LIMIT_ENABLED).toBe(false);
    expect(loadConfig({ NODE_ENV: 'development' }).RATE_LIMIT_ENABLED).toBe(false);
    expect(loadConfig({ NODE_ENV: 'production' }).RATE_LIMIT_ENABLED).toBe(true);
    expect(loadConfig({ NODE_ENV: 'test' }).RATE_LIMIT_ENABLED).toBe(true);
    expect(loadConfig({ RATE_LIMIT_ENABLED: 'true' }).RATE_LIMIT_ENABLED).toBe(true);
    expect(
      loadConfig({ NODE_ENV: 'production', RATE_LIMIT_ENABLED: 'false' }).RATE_LIMIT_ENABLED,
    ).toBe(false);
    expect(() => loadConfig({ RATE_LIMIT_ENABLED: 'disabled' })).toThrow('RATE_LIMIT_ENABLED');
  });
  it('boots mock with no provider secrets and resolves media independently of cwd', () => {
    const config = loadConfig({});
    expect(config.APP_MODE).toBe('mock');
    expect(config.GPT_MODEL).toBe('');
    expect(config.STT_PROVIDER).toBe('deepgram');
    expect(config.DEEPGRAM_STT_MODEL).toBe('nova-3');
    expect(config.DEEPGRAM_STT_LANGUAGE).toBe('zh-CN');
    expect(config.CORS_ALLOWED_ORIGINS).toEqual(['http://localhost:5173']);
    expect(isAbsolute(config.MEDIA_LOCAL_DIR)).toBe(true);
  });
  it('rejects incomplete live and R2 in mock without hidden fallback', () => {
    expect(() => loadConfig({ APP_MODE: 'live' })).toThrow('GPT_MODEL');
    expect(() => loadConfig({ MEDIA_STORE: 'r2' })).toThrow('R2_ACCESS_KEY_ID');
  });
  it('boots Live text interaction with only GPT and Deepgram configuration', () => {
    const config = loadConfig(liveTextConfig);
    expect(config.APP_MODE).toBe('live');
    expect(config.GPT_MODEL).toBe('configured-model');
    expect(config.DEEPGRAM_MODEL).toBe('flux-lijuan-zh');
  });
  it.each([
    { CORS_ALLOWED_ORIGINS: '*' },
    { TRUST_PROXY: 'true' },
    { TRUST_PROXY: '*' },
    { TRUST_PROXY: '192.168.0.1/33' },
    { CORS_ALLOWED_ORIGINS: 'https://a.com/path' },
    { GPT_HEADERS_JSON: '{"Authorization":"secret"}' },
    { GPT_EXTRA_BODY_JSON: '{"messages":[]}' },
    { GPT_EXTRA_BODY_JSON: 'null' },
    { GPT_API_STYLE: 'responses', GPT_STRUCTURED_OUTPUT: 'json_mode' },
    { FIRST_AUDIO_TIMEOUT_MS: '20000', TURN_MAX_LIFETIME_MS: '20000' },
    { DEEPGRAM_API_VERSION: 'v1' },
    { STT_PROVIDER: 'unknown' },
    { DEEPGRAM_STT_MODEL: 'https://invalid.example/model' },
    { DEEPGRAM_STT_LANGUAGE: 'zh&callback=invalid' },
  ])('rejects unsafe/unsupported configuration %j', (env) => {
    expect(() => loadConfig(env)).toThrow();
  });
  it('trusts only explicitly configured proxy addresses', () => {
    expect(loadConfig({ TRUST_PROXY: '127.0.0.1,10.0.0.0/24,::1' }).TRUST_PROXY).toEqual([
      '127.0.0.1',
      '10.0.0.0/24',
      '::1',
    ]);
  });
  it('probes recognition with only its key and planning without speech credentials', () => {
    expect(
      loadProbeConfig({ APP_MODE: 'live', DEEPGRAM_API_KEY: 'test-key' }, 'stt').DEEPGRAM_STT_MODEL,
    ).toBe('nova-3');
    expect(
      loadProbeConfig(
        {
          APP_MODE: 'live',
          GPT_BASE_URL: 'https://gpt.example/v1',
          GPT_API_KEY: 'test-key',
          GPT_MODEL: 'test-model',
        },
        'plan',
      ).GPT_MODEL,
    ).toBe('test-model');
    expect(() => loadConfig({ APP_MODE: 'live', DEEPGRAM_API_KEY: 'test-key' })).toThrow(
      'GPT_MODEL',
    );
  });
  it('standalone synthesis still requires its voice, and offline inspection needs no credentials', () => {
    expect(() =>
      loadProbeConfig({ APP_MODE: 'live', DEEPGRAM_API_KEY: 'test-key' }, 'tts'),
    ).toThrow('DEEPGRAM_MODEL');
    expect(
      loadProbeConfig(
        { APP_MODE: 'live', DEEPGRAM_API_KEY: 'test-key', DEEPGRAM_MODEL: 'flux-lijuan-zh' },
        'tts',
      ).APP_MODE,
    ).toBe('live');
    expect(loadProbeConfig({ APP_MODE: 'live' }, 'capabilities').APP_MODE).toBe('live');
  });
  it('never includes secret field values in errors', () => {
    expect(() => loadConfig({ GPT_EXTRA_BODY_JSON: '{"apiKey":"super-secret"}' })).toThrow(
      'GPT_EXTRA_BODY_JSON',
    );
    try {
      loadConfig({ GPT_EXTRA_BODY_JSON: '{"apiKey":"super-secret"}' });
    } catch (error) {
      expect(String(error)).not.toContain('super-secret');
    }
  });
});
