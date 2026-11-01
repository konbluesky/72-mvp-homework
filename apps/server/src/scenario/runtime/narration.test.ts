import { describe, expect, it } from 'vitest';
import { Compiler } from 'inkjs/full';
import { InkScenario, type InkContent } from './ink.js';

// Source only: runtime execution requires explicit user authorization.
function narrative(tags = 'thought:hesitation', narration = 'She pauses before looking up.') {
  const compiled = new Compiler(`VAR phase = 0
VAR location = "terrace"
VAR ambience = "quiet"
VAR ending = ""
VAR spoken = false
-> menu
=== start ===
-> menu
=== menu ===
+ [Stay # action:talk-stay] -> stay
=== stay ===
~ spoken = true
${narration} # cue:beat:pause # voice:reply # ${tags}
-> menu
`).Compile();
  const content: InkContent = {
    id: 'narrative-fixture',
    version: '1',
    hash: 'fixture',
    entry: 'menu',
    entries: { story: 'start', conversation: 'start' },
    bytecode: JSON.parse(compiled.ToJson()),
    phases: ['meeting'],
    actionDescriptions: {},
    locations: ['terrace'],
    ambiences: ['quiet'],
    endings: [],
    resourceIds: [],
    projection: { flags: ['spoken'], revealed: {}, facts: {} },
    presentation: { character: 'guide', environment: { default: 'clear', variants: [] } },
    directorNotes: [],
    voices: { reply: { text: 'Stay a little longer.', emotion: 'curious', action: 'none' } },
    thoughts: { hesitation: 'I hope this does not sound too eager.', second: 'Another thought.' },
    documents: [],
  };
  return new InkScenario(content);
}

describe('audience-only inner monologue', () => {
  it('keeps unspoken text out of dialogue, known lore and uncommitted progress', () => {
    const runtime = narrative();
    const initial = runtime.initial();
    const [beat] = runtime.propose('talk-stay', initial);
    expect(beat!.caption).toContain('\n\n心声｜I hope');
    expect(beat!.line?.text).toBe('Stay a little longer.');
    expect(JSON.stringify(runtime.frame(initial))).not.toContain('too eager');
    expect(runtime.frame(initial).story.milestones).not.toContain('spoken');
    const committed = runtime.accept(initial, beat!.checkpoint);
    expect(runtime.frame(committed).story.milestones).toContain('spoken');
    expect(runtime.frame(committed).known).toEqual([]);
  });

  it.each(['thought:missing', 'thought:hesitation # thought:second'])(
    'rejects missing or duplicated private references: %s',
    (tags) => {
      const runtime = narrative(tags);
      expect(() => runtime.propose('talk-stay', runtime.initial())).toThrow();
    },
  );

  it('applies the network caption budget after adding the inner text and its labels', () => {
    const runtime = narrative('thought:hesitation', 'N'.repeat(220));
    expect(() => runtime.propose('talk-stay', runtime.initial())).toThrow();
  });
});
