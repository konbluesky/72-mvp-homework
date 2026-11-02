import { useId, useState } from 'react';
import { splitStageNarrative } from './stage-narrative';
import './stage-narrative.css';

interface Props {
  caption: string;
  speaker: string;
  side: 'left' | 'right';
  solitary?: boolean;
}

/** Reads the Scheduler projection only; contains no timers, facts or presentation receipts. */
export function StageNarrative({ caption, speaker, side, solitary = false }: Props) {
  const { narration, thought } = splitStageNarrative(caption);
  const [preferred, setPreferred] = useState<'narration' | 'thought'>('thought');
  const id = useId();
  const channel =
    preferred === 'thought' && thought ? 'thought' : narration ? 'narration' : 'thought';
  if (!narration && !thought) return null;

  return (
    <aside
      className={`stage-narrative${solitary ? ' is-solitary' : ''}`}
      data-side={side}
      data-channel={channel}
      aria-label="舞台叙事"
      aria-live="polite"
      aria-atomic="true"
    >
      {narration && thought && (
        <div className="stage-narrative-tabs" role="group" aria-label="选择叙事文字">
          <button
            id={`${id}-narration-tab`}
            type="button"
            aria-pressed={channel === 'narration'}
            aria-controls={`${id}-narration`}
            onClick={() => setPreferred('narration')}
          >
            旁白
          </button>
          <button
            id={`${id}-thought-tab`}
            type="button"
            aria-pressed={channel === 'thought'}
            aria-controls={`${id}-thought`}
            onClick={() => setPreferred('thought')}
          >
            {speaker} · 心声
          </button>
        </div>
      )}
      {thought && (
        <section className="stage-thought" id={`${id}-thought`} aria-label={`${speaker}的心声`}>
          <span className="stage-narrative-label">
            {speaker}
            <i aria-hidden="true" />
            心声
          </span>
          <p tabIndex={0}>{thought}</p>
        </section>
      )}
      {narration && (
        <section className="stage-narration" id={`${id}-narration`} aria-label="场景旁白">
          <span className="stage-narrative-label">旁白</span>
          <p tabIndex={0}>{narration}</p>
        </section>
      )}
    </aside>
  );
}
