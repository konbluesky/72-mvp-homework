import { describe, expect, it } from 'vitest';
import {
  LOCATIONS,
  cafeLocation,
  cafeConversationAvailable,
  cafeAdvanceAction,
} from './definition.js';
import { cafeResource } from './resources.js';
import metadata from './manifest.generated.json';
describe('scene package render bindings', () => {
  it('pairs authored locations and resource IDs with registered rendering entries', () => {
    expect(Object.keys(LOCATIONS).sort()).toEqual(Object.keys(metadata.locations).sort());
    for (const [id, label] of Object.entries(metadata.locations))
      expect(cafeLocation(id).label).toBe(label);
    for (const id of Object.keys(metadata.resources))
      expect(cafeResource(id).url).toMatch(/^\/assets\//);
    expect(() => cafeLocation('not-registered')).toThrow();
    expect(() => cafeResource('not-registered')).toThrow();
  });
  it('keeps action anchors and opposite window directions local to each room', () => {
    expect(cafeLocation('window-seat').anchors['view-photo']).toEqual([1000, 1250]);
    expect(cafeLocation('counter').anchors['view-photo']).toBeUndefined();
    expect(cafeLocation('window-seat').lookDirection).toBe(-1);
    expect(cafeLocation('counter').lookDirection).toBe(1);
  });
  it('uses only the current server-issued shortcut and never substitutes a relationship choice', async () => {
    const { initialStory } = await import('@mira/protocol');
    const state = initialStory();
    const decision = {
      id: 'choose-night',
      kind: 'choose' as const,
      label: '一起离开',
      description: '',
      explicit: true,
    };
    expect(cafeAdvanceAction({ ...state, actions: [decision] })).toBeUndefined();
    const next = { ...decision, id: 'talk-next-scene', kind: 'talk' as const, label: '下一段' };
    expect(cafeAdvanceAction({ ...state, actions: [decision, next] })).toBe(next);
    expect(cafeAdvanceAction({ ...state, revision: 1, actions: [] })).toBeUndefined();
  });
});

it('renders an independent viewpoint without changing the player location', async () => {
  const { initialStory, projectStory, BeatEventSchema } = await import('@mira/protocol');
  const { stageScene } = await import('./definition.js');
  const waiting = initialStory({ location: 'window-seat', ambience: 'open' });
  const next = projectStory(
    waiting,
    BeatEventSchema.parse({
      type: 'beat',
      beatId: 'private-view',
      shot: { location: 'washroom', mode: 'character' },
    }),
  );
  expect(next.location).toBe('window-seat');
  expect(stageScene(next, 'rain').background).toBe('washroom');
  expect(
    BeatEventSchema.safeParse({
      type: 'beat',
      beatId: 'untrusted',
      shot: { location: 'https://example.invalid', mode: 'character' },
    }).success,
  ).toBe(false);
  expect(
    BeatEventSchema.safeParse({
      type: 'beat',
      beatId: 'untrusted',
      shot: { location: 'washroom', mode: 'execute' },
    }).success,
  ).toBe(false);
});

it('keeps the character absent before meeting and enables conversation after entering', async () => {
  const { initialStory } = await import('@mira/protocol');
  const outside = initialStory({ location: 'cafe-front', ambience: 'open', phase: 'arrival' });
  expect(cafeLocation('cafe-front', outside).visible).toBe(false);
  expect(cafeConversationAvailable(outside)).toBe(false);
  const entered = { ...outside, location: 'lobby', milestones: ['met'] };
  expect(cafeLocation('lobby', entered).visible).toBe(true);
  expect(cafeConversationAvailable(entered)).toBe(true);
});
