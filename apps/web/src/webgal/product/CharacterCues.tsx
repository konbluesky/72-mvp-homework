import type { CharacterFrame } from '../../scene/character.js';
import { characterCue } from '../../scene/character-cues.js';
import '../../scene/character-cues.css';

export function CharacterCues({
  frame,
  style,
}: {
  frame: CharacterFrame;
  style?: React.CSSProperties;
}) {
  const cue = characterCue(frame.interaction, frame.emotion);
  const energy =
    frame.interaction === 'speaking' && Number.isFinite(frame.mouthOpen)
      ? Math.max(0, Math.min(1, frame.mouthOpen))
      : 0;
  return (
    <div
      className="character-cues"
      data-cue={cue.kind}
      data-emotion={frame.emotion}
      style={{ ...style, '--cue-energy': energy } as React.CSSProperties}
      aria-hidden="true"
    >
      <div className="character-emote-bubble">
        {cue.kind === 'thinking' ? (
          <span className="character-thought-dots">
            <i />
            <i />
            <i />
          </span>
        ) : cue.kind === 'speaking' ? (
          <span className="character-cue-voice">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
        ) : (
          <span className="character-cue-symbol">{cue.symbol}</span>
        )}
        <span className="character-cue-label">{cue.label}</span>
      </div>
      {cue.kind === 'listening' && (
        <span className="character-listening-rays">
          <i />
          <i />
          <i />
        </span>
      )}
    </div>
  );
}
