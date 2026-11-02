import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { MediaService } from '../media/index.js';
import { validateImage } from './format.js';
import { MemoryMediaStore, testConfig, deferred, wav } from '../../test/helpers.js';
import { ImageSharingService } from './sharing.js';
import { SessionManager } from '../sessions/manager.js';
import { cafeScenario } from '../scenario/cafe/index.js';
import type { ImageRecipe, ImageProvider } from './types.js';
const recipe: Omit<ImageRecipe, 'intent' | 'seed'> = {
  slotKey: 'test',
  title: 'test',
  originLabel: 'test',
  character: 'adult',
  appearance: 'coat',
  location: 'window-seat',
  environment: 'room',
  positive: 'test',
  negative: 'test',
  width: 1024,
  height: 1024,
  introduction: 'test',
  readyLine: 'test',
};
describe('image queue and private media boundaries', () => {
  it('bounds running/queued work and cancellation releases only its own worker', async () => {
    const config = testConfig({ IMAGE_MAX_ACTIVE: '1', IMAGE_MAX_QUEUED: '1' });
    const media = new MediaService(config, new MemoryMediaStore());
    const sessions = new SessionManager(config, {
      scenario: {
        ...cafeScenario,
        imageSharing: { mockImage: 'unused', candidate: () => recipe, accepts: () => true },
      },
    });
    const generate = vi.fn<ImageProvider['generate']>(
      async (_recipe, _correlation, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    );
    const service = new ImageSharingService(config, sessions, media, { simulated: true, generate });
    function announce() {
      const created = sessions.create();
      const session = sessions.authenticate(created.sessionId, `Bearer ${created.sessionToken}`);
      session.confirmedConversation = {
        revision: session.narrative.revision,
        location: session.story.location,
      };
      sessions.begin(session, { generation: 1, turnId: 'turn', receipts: [], frozenTurns: [] });
      const turn = session.current!;
      const work = sessions.reserveImage(
        session,
        turn,
        { focus: 'environment', mood: 'quiet', framing: 'medium' },
        true,
      )!;
      sessions.issueImageSlot(session, turn, work);
      sessions.receipts(session, [
        {
          ...turn.identity,
          receiptId: 'slot',
          targetId: work.slotEventId,
          kind: 'image-slot',
          status: 'presented',
        },
      ]);
      return { session, work };
    }
    try {
      const first = announce(),
        second = announce(),
        third = announce();
      expect(generate).toHaveBeenCalledTimes(1);
      expect(second.work.work).toBe('queued');
      expect(third.work.share.phase).toBe('failed');
      sessions.endImage(first.session, first.work, 'cancelled');
      await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
      expect(second.work.share.phase).toBe('preparing');
      expect(second.work.abort.signal.aborted).toBe(false);
    } finally {
      sessions.close();
      await service.close();
      await media.close();
    }
  });
  it('keeps task images when a chat turn is deleted and reclaims a late write after session removal', async () => {
    const config = testConfig();
    const store = new MemoryMediaStore();
    const media = new MediaService(config, store);
    const checked = await validateImage(
      await readFile('assets/images/window-keepsake-mock.webp'),
      config.MAX_IMAGE_BYTES,
      config.FFMPEG_PATH,
      new AbortController().signal,
    );
    try {
      const audio = await media.put(
        'session',
        'turn',
        { bytes: wav(), mimeType: 'audio/wav' },
        new AbortController().signal,
      );
      const image = await media.putImage('session', 'share', checked, new AbortController().signal);
      await media.deleteTurn('session', 'turn');
      expect(media.available(image.assetId, 'session')).toBe(true);
      expect(media.available(audio.assetId, 'session')).toBe(false);
      const release = deferred<void>();
      const original = store.put.bind(store);
      vi.spyOn(store, 'put').mockImplementationOnce(async (...args) => {
        await release.promise;
        await original(...args);
      });
      const late = media.putImage('session', 'second-share', checked, new AbortController().signal);
      const rejected = expect(late).rejects.toMatchObject({ code: 'MEDIA_FAILED' });
      await media.deleteSession('session');
      release.resolve();
      await rejected;
      expect(store.entries.size).toBe(0);
      expect(media.stats().assets).toBe(0);
    } finally {
      await media.close();
    }
  });
  it('rejects invalid signatures, truncated content and oversized input without publishing an image', async () => {
    const config = testConfig();
    const signal = new AbortController().signal;
    await expect(
      validateImage(new Uint8Array([1, 2, 3]), config.MAX_IMAGE_BYTES, config.FFMPEG_PATH, signal),
    ).rejects.toThrow('invalid_image');
    await expect(
      validateImage(
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        config.MAX_IMAGE_BYTES,
        config.FFMPEG_PATH,
        signal,
      ),
    ).rejects.toThrow('invalid_image');
    await expect(
      validateImage(new Uint8Array(100), 50, config.FFMPEG_PATH, signal),
    ).rejects.toThrow('invalid_image');
  });
});
