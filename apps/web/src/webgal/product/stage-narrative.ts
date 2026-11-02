/** Presentation labels emitted by the narrative adapter, never story-routing keywords. */
export function splitStageNarrative(caption: string): { narration: string; thought: string } {
  const source = caption.trim();
  if (!source.startsWith('旁白｜')) return { narration: source, thought: '' };
  const separator = '\n\n心声｜';
  const offset = source.indexOf(separator);
  return offset < 0
    ? { narration: source.slice(3).trim(), thought: '' }
    : {
        narration: source.slice(3, offset).trim(),
        thought: source.slice(offset + separator.length).trim(),
      };
}
