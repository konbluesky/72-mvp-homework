import { describe, expect, it } from 'vitest';
import { Compiler } from 'inkjs/full';
import { LocationSchema, FactsSchema } from '@mira/protocol';
import { InkScenario, type InkContent } from './ink.js';

function module(locations = ['terrace']): InkScenario {
  const compiled = new Compiler(`VAR phase = 4
VAR location = "terrace"
VAR ambience = "daylight"
VAR ending = ""
VAR light_ready = false
-> menu
=== start ===
-> menu
=== menu ===
* [Look at the lamp # action:inspect-lamp] -> inspect_lamp
=== inspect_lamp ===
~ light_ready = true
The lamp is visible. # cue:beat:lamp-visible
-> menu
`).Compile();
  const content: InkContent = {
    id: 'other-story',
    version: '1',
    hash: 'fixture',
    entry: 'menu',
    entries: { story: 'start', conversation: 'start' },
    bytecode: JSON.parse(compiled.ToJson()),
    phases: ['one', 'two', 'three', 'four', 'five'],
    actionDescriptions: {},
    locations,
    ambiences: ['daylight'],
    endings: [],
    resourceIds: [],
    projection: { flags: ['light_ready'], revealed: {}, facts: { lamp_visible: 'light_ready' } },
    presentation: { character: 'guide', environment: { default: 'clear', variants: [] } },
    directorNotes: [],
    voices: {},
    documents: [],
  };
  return new InkScenario(content);
}
describe('content-neutral scenario boundary', () => {
  it('supports a new location, fifth phase and unrelated facts without protocol edits', () => {
    expect(LocationSchema.parse('terrace')).toBe('terrace');
    expect(FactsSchema.parse({ lamp_visible: false })).toEqual({ lamp_visible: false });
    const runtime = module();
    const initial = runtime.initial();
    const frame = runtime.frame(initial);
    expect(frame.story).toMatchObject({ location: 'terrace', phase: 'five', ambience: 'daylight' });
    expect(frame.facts).toEqual({ lamp_visible: false });
    expect(frame.presentation).toEqual({ character: 'guide', environment: 'clear' });
  });
  it('keeps proposed custom progress isolated until an accepted checkpoint', () => {
    const runtime = module();
    const initial = runtime.initial();
    const proposed = runtime.propose('inspect-lamp', initial);
    expect(proposed).toHaveLength(1);
    expect(runtime.frame(initial).facts).toEqual({ lamp_visible: false });
    const next = runtime.accept(initial, proposed[0]!.checkpoint);
    expect(runtime.frame(next).facts).toEqual({ lamp_visible: true });
    expect(() => runtime.accept(next, proposed[0]!.checkpoint)).toThrow();
  });
  it('rejects undeclared content even when its identifier is structurally valid', () => {
    const runtime = module(['laboratory']);
    expect(() => runtime.frame(runtime.initial())).toThrow();
    expect(LocationSchema.safeParse('../../private').success).toBe(false);
    expect(LocationSchema.safeParse('https://outside.example').success).toBe(false);
  });
});
