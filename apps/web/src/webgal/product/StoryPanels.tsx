import { useEffect, useRef } from 'react';
import type { StoryAction } from '@mira/protocol';
import type { InteractiveState } from '../../interaction/state';
import type { InteractiveHost } from './host';
import { CHARACTERS, isCharacterId, characterProfile } from '../characters/profiles/index';
import { StoryIcon } from './StoryIcon';

export type StoryPanel = 'locations' | 'menu' | 'history' | 'document' | 'restart' | null;
export interface StoryLogEntry {
  id: number;
  kind: 'speech' | 'narration' | 'user' | 'opening';
  text: string;
}
interface Props {
  panel: StoryPanel;
  state: InteractiveState;
  host: InteractiveHost;
  navigation: StoryAction[];
  canAct: boolean;
  log: StoryLogEntry[];
  onClose(): void;
  onOpen(panel: StoryPanel): void;
  onAction(action: StoryAction): void;
  onRestart(): void;
}
const titles = {
  locations: '去别处看看',
  menu: '故事菜单',
  history: '对话回看',
  document: '阅读资料',
  restart: '重新开始',
};
export function StoryPanels({
  panel,
  state,
  host,
  navigation,
  canAct,
  log,
  onClose,
  onOpen,
  onAction,
  onRestart,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (panel) {
      if (!element.open) element.showModal();
      element.querySelector<HTMLButtonElement>('.story-dialog-header button')?.focus();
    } else if (element.open) element.close();
  }, [panel]);
  function closePanel() {
    if (panel === 'document') host.presentation?.dismiss();
    onClose();
  }
  function preview(run: () => void) {
    onClose();
    host.controller.interrupt();
    run();
  }
  return (
    <dialog
      ref={dialog}
      className={`story-dialog story-dialog-${panel ?? 'closed'}`}
      aria-labelledby="story-panel-title"
      onCancel={(event) => {
        event.preventDefault();
        closePanel();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const r = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < r.left ||
          event.clientX > r.right ||
          event.clientY < r.top ||
          event.clientY > r.bottom
        )
          closePanel();
      }}
    >
      <header className="story-dialog-header">
        <h2 id="story-panel-title">{panel ? titles[panel] : ''}</h2>
        <button className="story-icon-button" aria-label="关闭面板" onClick={closePanel}>
          <StoryIcon name="close" />
        </button>
      </header>
      <div className="story-dialog-body">
        {panel === 'locations' && (
          <>
            <p className="panel-context">
              <StoryIcon name="location" />
              当前位置 · {host.location.label}
            </p>
            <nav className="location-options" aria-label="当前可前往的地点">
              {navigation.map((action) => (
                <button key={action.id} disabled={!canAct} onClick={() => onAction(action)}>
                  <span>{action.label}</span>
                  <StoryIcon name="arrow" />
                </button>
              ))}
            </nav>
            {!navigation.length && <p className="panel-note">这里暂时没有可前往的地点。</p>}
          </>
        )}
        {panel === 'history' && (
          <>
            <p className="panel-note">本页已显示的文字。语音可能在句中被打断。</p>
            <div className="story-backlog">
              {log.length ? (
                log.map((entry) => (
                  <article key={entry.id} className={`backlog-entry backlog-${entry.kind}`}>
                    <small>
                      {entry.kind === 'user'
                        ? '你'
                        : entry.kind === 'speech'
                          ? host.scene.speaker
                          : entry.kind === 'opening'
                            ? '开场文字'
                            : '场景'}
                    </small>
                    <p>{entry.text}</p>
                  </article>
                ))
              ) : (
                <p className="panel-note">本次会话的对话会留在这里。</p>
              )}
            </div>
          </>
        )}
        {panel === 'document' && (
          <article className="readable-document">
            <h3>{state.documentTitle}</h3>
            <p>{state.documentText}</p>
          </article>
        )}
        {panel === 'restart' && (
          <div className="restart-confirm">
            <p>重新开始这段故事？</p>
            <span>当前相遇将结束，从头开始这次会话。</span>
            <button className="story-primary" onClick={onRestart}>
              重新开始 <StoryIcon name="refresh" />
            </button>
          </div>
        )}
        {panel === 'menu' && (
          <>
            <div className="menu-story">
              <span>当前场景</span>
              <h3>{host.location.label}</h3>
            </div>
            <div className="menu-links">
              <button onClick={() => onOpen('locations')}>
                <StoryIcon name="location" />
                <span>去别处看看</span>
                <StoryIcon name="arrow" />
              </button>
              <button onClick={() => onOpen('history')}>
                <StoryIcon name="book" />
                <span>对话回看</span>
                <StoryIcon name="arrow" />
              </button>
              <button onClick={() => onOpen('restart')}>
                <StoryIcon name="refresh" />
                <span>重新开始</span>
                <StoryIcon name="arrow" />
              </button>
            </div>
            <details className="menu-section">
              <summary>场景与操作</summary>
              <p>
                对话入口始终可用。你可以自己说，也可以选择角色回复下方的下一句话。角色会通过回应和身边的事物带你继续。
              </p>
              <p>
                选择推荐句会作为你的发言发送；录音松开后先识别，确认文字后才发送。也可以在这里查看地点，或使用舞台上已有的物件操作。
              </p>
              <p>角色说话或场景演出中，可以随时停止或发送新消息。未完成的演出不会算作已经发生。</p>
            </details>
            <details className="menu-section">
              <summary>外观与连接</summary>
              <label className="character-setting">
                角色外观
                <select
                  aria-label="角色外观"
                  value={host.characterId}
                  disabled={state.animation === 'loading'}
                  onChange={(event) => {
                    if (isCharacterId(event.target.value))
                      void host.selectCharacter(event.target.value);
                  }}
                >
                  {host.scene.characters.map((id) => (
                    <option key={id} value={id}>
                      {CHARACTERS[id].label}
                      {id === host.scene.defaultCharacter ? ' · 默认' : ' · 可选'}
                    </option>
                  ))}
                </select>
              </label>
              <p>切换外观会停止当前演出，不改变已经确认的剧情。</p>
              <p>
                {state.connected
                  ? state.mode === 'live'
                    ? '实时模式 · Deepgram / GPT'
                    : '演示模式 · 本地回复与示例语音'
                  : state.connecting
                    ? '正在连接服务'
                    : '连接已断开'}
              </p>
              {!state.connected && (
                <button className="story-secondary" onClick={() => host.reconnect()}>
                  重新连接
                </button>
              )}
              <p>
                {CHARACTERS[host.characterId].attribution}。当前模型为 {host.scene.speaker}{' '}
                的技术替身。
              </p>
              <a
                className="menu-text-link"
                href="/assets/live2d/NOTICE.md"
                target="_blank"
                rel="noreferrer"
              >
                素材与许可来源 <StoryIcon name="arrow" />
              </a>
            </details>
            <details className="menu-section integration-details">
              <summary>开发预览</summary>
              <p>以下预览不写入剧情事实；新输入或停止会退出预览。</p>
              <div className="developer-grid">
                <button
                  onClick={() => preview(() => host.playback.previewScene(1.12, state.environment))}
                >
                  镜头拉近
                </button>
                {host.scene.environmentPreviews.map((preset) => (
                  <button
                    key={preset.value}
                    onClick={() => preview(() => host.playback.previewScene(1, preset.value))}
                  >
                    {preset.label}
                  </button>
                ))}
                <button onClick={() => preview(() => host.playback.preview('acknowledge'))}>
                  抬手示意
                </button>
                <button onClick={() => preview(() => host.playback.preview('none', 'thinking'))}>
                  偏头沉思
                </button>
                <button onClick={() => preview(() => host.playback.preview('lookWindow'))}>
                  望窗回看
                </button>
                {characterProfile(host.characterId).motionGroups.map((group) => (
                  <button
                    key={group}
                    onClick={() => preview(() => host.playback.preview('none', 'idle', group))}
                  >
                    原始 {group}
                  </button>
                ))}
              </div>
              <button
                className="story-secondary"
                onClick={() => {
                  onClose();
                  void host.rebuildStage();
                }}
              >
                重建舞台
              </button>
              <details>
                <summary>模型参数与状态</summary>
                <pre>
                  {JSON.stringify(
                    {
                      parameters: host.characterParameters,
                      location: state.story.location,
                      revealed: state.story.revealed,
                      ending: state.story.ending,
                      weather: state.environment,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
              <a
                className="menu-text-link"
                href="/webgal.html?preview=1"
                target="_blank"
                rel="noreferrer"
              >
                原引擎预览 <StoryIcon name="arrow" />
              </a>
            </details>
            <a
              className="menu-text-link legacy-page-link"
              href="/"
              target="_blank"
              rel="noopener noreferrer"
            >
              打开原版对话 <StoryIcon name="arrow" />
            </a>
          </>
        )}
      </div>
    </dialog>
  );
}
