import { DoubleRight, ReplayMusic, Pic, SettingTwo } from '@icon-park/react';
import native from '../../engine/webgal/UI/BottomControlPanel/bottomControlPanel.module.scss';
import './stage-controls.css';

interface Props {
  canAdvance: boolean;
  advanceLabel: string;
  advanceDisabled: boolean;
  choosing: boolean;
  voicePlayback: boolean;
  voiceDisabled: boolean;
  imageLabel?: string;
  imageTitle?: string;
  imageDisabled: boolean;
  moreDisabled: boolean;
  moreOpen: boolean;
  onAdvance(): void;
  onVoice(): void;
  onImage(): void;
  onMore(): void;
}

/** Reuse WebGAL's native control skin; callbacks retain the server-owned event flow. */
export function StageControls(props: Props) {
  const button = `${native.singleButton} webgal-stage-control`;
  return (
    <nav className={`${native.main} webgal-stage-controls`} aria-label="WebGAL 舞台工具栏">
      {props.canAdvance && <button className={button} type="button"
        aria-label={props.choosing ? '剧情选择' : '推进剧情'} title={props.advanceLabel}
        disabled={props.advanceDisabled} onClick={props.onAdvance}>
        <DoubleRight className={native.button} />
        <span className={native.button_text}>{props.choosing ? '选择' : '推进'}</span>
      </button>}
      <button className={button} type="button" aria-label="语音播报" aria-pressed={props.voicePlayback}
        title="开关语音播报，关闭会停止当前播报" disabled={props.voiceDisabled} onClick={props.onVoice}>
        <ReplayMusic className={native.button} />
        <span className={native.button_text}>语音{props.voicePlayback ? '开' : '关'}</span>
      </button>
      {props.imageLabel && <button className={button} type="button" aria-label={props.imageLabel}
        title={props.imageTitle} disabled={props.imageDisabled} onClick={props.onImage}>
        <Pic className={native.button} />
        <span className={native.button_text}>{props.imageLabel === '查看图片' ? '图片' : '生图'}</span>
      </button>}
      <button className={button} type="button" aria-label="更多剧情互动" aria-expanded={props.moreOpen}
        disabled={props.moreDisabled} onClick={props.onMore}>
        <SettingTwo className={native.button} />
        <span className={native.button_text}>更多</span>
      </button>
    </nav>
  );
}
