import { describe, expect, it } from 'vitest';
import type { ReplyPlan } from '@mira/protocol';
import { photoRequested, validateStory } from './rules.js';
const photo: ReplyPlan = {
  suggestions: [],
  segments: [
    {
      text: '给你看。',
      emotion: 'relieved',
      action: 'offerPhoto',
      events: [{ type: 'photo', resourceId: 'travel_photo_01' }],
    },
  ],
};
const facts = { photo_revealed: false, rain_softened: false };
describe('scenario authorization', () => {
  it.each(['能看看照片吗？', '让我看看照片', '照片能给我看看吗？', 'Can I see the photo?'])(
    'recognizes explicit photo request: %s',
    (text) => expect(photoRequested(text)).toBe(true),
  );
  it.each(['我有一张照片。', '不要给我看照片', '照片不用看了', "Don't show the photo", '你好'])(
    'does not reveal for refusal or mere mention: %s',
    (text) => {
      expect(photoRequested(text)).toBe(false);
      expect(() => validateStory(photo, text, facts)).toThrow();
    },
  );
  it('rejects environment before either a previous confirmed photo or a planned photo', () => {
    const plan: ReplyPlan = {
      suggestions: [],
      segments: [
        {
          text: '雨小了。',
          emotion: 'relieved',
          action: 'none',
          events: [{ type: 'environment', environment: 'rain-soft' }],
        },
      ],
    };
    expect(() => validateStory(plan, '雨会停吗', facts)).toThrow();
    expect(() =>
      validateStory(plan, '雨会停吗', { photo_revealed: true, rain_softened: false }),
    ).not.toThrow();
  });
});
