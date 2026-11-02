import { describe, expect, it } from 'vitest';
import { CaptionReadyPayloadSchema, JsonInputSchema, AudioInputMetadataSchema } from './index.js';

describe('explicit voice output and image request boundaries', () => {
  it('accepts voice-off without changing recording or scene authorization', () => {
    expect(
      JsonInputSchema.parse({ generation: 1, inputId: 'input', text: '你好', voicePlayback: false })
        .voicePlayback,
    ).toBe(false);
    expect(
      AudioInputMetadataSchema.parse({
        generation: 1,
        inputId: 'input',
        durationMs: 1000,
        voicePlayback: false,
      }).voicePlayback,
    ).toBe(false);
    expect(
      JsonInputSchema.safeParse({
        generation: 1,
        inputId: 'input',
        text: '你好',
        voicePlayback: 'false',
      }).success,
    ).toBe(false);
  });
  it('requires an image request revision and rejects client supplied recipes and destinations', () => {
    const request = {
      generation: 1,
      inputId: 'input',
      interaction: { kind: 'image', revision: 4 },
    };
    expect(JsonInputSchema.safeParse(request).success).toBe(true);
    expect(JsonInputSchema.safeParse({ ...request, interaction: { kind: 'image' } }).success).toBe(
      false,
    );
    expect(
      JsonInputSchema.safeParse({
        ...request,
        interaction: { ...request.interaction, url: 'https://untrusted.example/image' },
      }).success,
    ).toBe(false);
  });
  it('limits automatic caption completion to the declared caption payload', () => {
    const caption = {
      segmentId: 'caption',
      text: '你好',
      emotion: 'curious',
      action: 'none',
      events: [],
      captionOnly: true,
      autoAdvance: true,
    };
    expect(CaptionReadyPayloadSchema.safeParse(caption).success).toBe(true);
    expect(
      CaptionReadyPayloadSchema.safeParse({ ...caption, audioUrl: '/api/media/not-a-caption' })
        .success,
    ).toBe(false);
  });
});
