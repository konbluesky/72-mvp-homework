import { retainReading } from '../../interaction/conversation-items.js';
import { ImageShareCard } from '../../images/ImageShareCard';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReplySuggestion, StoryAction } from '@mira/protocol';
import { InteractiveHost } from './host';
import { CHARACTERS } from '../characters/profiles/index';
import { PLATFORM_NAME } from '../../app/platform';
import {
  protectRecordingGesture,
  type RecordingGestureGuard,
} from '../../interaction/recording-gesture';
import {
  canUseStoryActions,
  currentStoryAction,
  canSubmitConversation,
  conversationSuggestions,
  selectedConversationReply,
  groupStoryActions,
} from './interaction-layout';
import { StoryIcon } from './StoryIcon';
import { StoryPanels, type StoryLogEntry, type StoryPanel } from './StoryPanels';
import { DraftSchema, ReadingHistorySchema } from '../../persistence/browser.js';
import { MessageStatus } from './MessageStatus';
import { StageNarrative } from './StageNarrative';
import '../../interaction/messages.css';

export function StoryApp({ scene }: { scene: import('../scenes/module.js').SceneModule }) {
  const [host, setHost] = useState(() => new InteractiveHost(scene));
  const state = useSyncExternalStore(host.subscribe, host.getSnapshot);
  const [draft, setDraft] = useState(() => host.api.persistence?.read('draft', DraftSchema) ?? '');
  const draftText = useRef(draft);
  const [panel, setPanel] = useState<StoryPanel>(null);
  const [exploring, setExploring] = useState(false);
  const [inputMode, setInputMode] = useState<'text' | 'voice'>(
    () => host.api.persistence?.preferences().inputMode ?? 'text',
  );
  const [log, setLog] = useState<StoryLogEntry[]>(
    () => host.api.persistence?.read('history', ReadingHistorySchema) ?? [],
  );
  const currentLog = useRef(log);
  const [, resize] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const stageElement = useRef<HTMLElement>(null);
  const chatLog = useRef<HTMLDivElement>(null);
  const followLog = useRef(true);
  const logId = useRef(Math.max(0, ...log.map((line) => line.id)));
  const openingSeen = useRef<unknown>();
  const userTurnSeen = useRef(log.some((line) => line.kind === 'user'));
  const focusText = useRef(false);
  const seenText = useRef({ subtitle: '', narration: '' });
  const pointer = useRef<number>();
  const recordingGesture = useRef<RecordingGestureGuard>();
  const pressY = useRef(0);
  useEffect(() => {
    host.controller.images.gate({ draft: !!draft.trim(), modal: !!panel });
  }, [host, draft, panel]);
  useEffect(() => {
    if (host.isDisposed) return;
    setLog((entries) => {
      const added = state.imageItems
        .filter((item) => !entries.some((line) => line.shareId === item.shareId))
        .map((item) => ({
          id: ++logId.current,
          kind: 'image-share' as const,
          shareId: item.shareId,
          text: '',
        }));
      return added.length ? retainReading([...entries, ...added]) : entries;
    });
  }, [host, state.imageItems]);
  useEffect(() => {
    if (inputMode !== 'voice' || state.voicePreview !== 'idle') finishRecordingGesture();
  }, [inputMode, state.voicePreview]);

  useEffect(() => {
    if (host.isDisposed) {
      setHost(new InteractiveHost(scene));
      return;
    }
    openingSeen.current = undefined;
    seenText.current = { subtitle: '', narration: '' };
    void host.start();
    return () => host.dispose();
  }, [host]);
  useEffect(() => {
    currentLog.current = log;
    host.api.persistence?.write('history', log);
  }, [host, log]);
  useEffect(() => {
    if (state.connected) host.api.persistence?.updatePreferences({ inputMode });
  }, [host, inputMode, state.connected]);
  useEffect(() => {
    const pagehide = () => {
      const subtitle = seenText.current.subtitle;
      const entries = currentLog.current.map((line) =>
        subtitle && line.kind === 'speech' && line.text === subtitle
          ? { ...line, paused: true }
          : line,
      );
      host.api.persistence?.write('history', entries);
    };
    window.addEventListener('pagehide', pagehide);
    return () => window.removeEventListener('pagehide', pagehide);
  }, [host]);
  useEffect(() => {
    const element = stageElement.current;
    if (!element) return;
    const observer = new ResizeObserver(() => resize((value) => value + 1));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (host.isDisposed) return;
    const previous = seenText.current;
    const additions: StoryLogEntry[] = [];
    if (state.subtitle && state.subtitle !== previous.subtitle) {
      additions.push({
        id: ++logId.current,
        kind: 'speech',
        text: state.subtitle,
        messageId: state.activeMessageId || undefined,
      });
    }
    if (state.narration && state.narration !== previous.narration) {
      additions.push({
        id: ++logId.current,
        kind: 'narration',
        text: state.narration,
        messageId: state.activeMessageId || undefined,
      });
    }
    seenText.current = { subtitle: state.subtitle, narration: state.narration };
    if (additions.length) setLog((entries) => retainReading([...entries, ...additions]));
  }, [host, state.subtitle, state.narration, state.story.location, state.activeMessageId]);
  useEffect(() => {
    if (host.isDisposed || !state.opening || openingSeen.current === state.opening) return;
    openingSeen.current = state.opening;
    const opening = state.opening;
    setLog((entries) =>
      entries.length ? entries : [{ id: ++logId.current, kind: 'opening', text: opening.text }],
    );
  }, [host, state.opening]);
  useEffect(() => {
    if (host.isDisposed || state.voicePreview !== 'ready') return;
    editDraft(state.voiceDraft);
    setInputMode('text');
  }, [host, state.voicePreview, state.voiceDraft]);
  useEffect(() => {
    if (state.connected && !state.voiceInput) setInputMode('text');
  }, [state.connected, state.voiceInput]);
  useEffect(() => {
    if (host.isDisposed) return;
    if (inputMode === 'text' && (state.voicePreview === 'ready' || focusText.current)) {
      focusText.current = false;
      input.current?.focus();
    }
  }, [host, inputMode, state.voicePreview]);
  useEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.max(28, Math.min(108, element.scrollHeight))}px`;
  }, [draft, inputMode]);
  useEffect(() => {
    if (!host.isDisposed && followLog.current && chatLog.current)
      chatLog.current.scrollTop = chatLog.current.scrollHeight;
  }, [host, log, state.interaction, state.playback]);
  useEffect(() => {
    setExploring(false);
  }, [state.story.location, state.story.revision]);
  useEffect(() => {
    if (state.recording !== 'idle' || state.voicePreview !== 'idle' || state.documentTitle)
      setExploring(false);
    if (panel === 'document' && !state.documentTitle) setPanel(null);
  }, [state.story.location, state.recording, state.voicePreview, state.documentTitle, panel]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (host.getSnapshot().recording !== 'idle') {
        event.preventDefault();
        cancelRecording();
      } else setExploring(false);
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [host]);
  useEffect(() => {
    const blur = () => {
      if (pointer.current !== undefined || host.getSnapshot().recording !== 'idle')
        cancelRecording();
    };
    const visibility = () => {
      if (document.hidden) blur();
    };
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', visibility);
      recordingGesture.current?.dispose();
    };
  }, [host]);

  const groups = useMemo(() => groupStoryActions(state.story.actions), [state.story.actions]);
  const busy =
    state.interaction === 'thinking' ||
    state.interaction === 'speaking' ||
    state.playback === 'buffering';
  const canAct = canUseStoryActions(state);
  const privateView = !!state.story.shot && state.story.shot.mode !== 'shared';
  const canChat = canSubmitConversation(state) && !privateView;
  // Keep the active pointer target enabled through permission and recording phases.
  const canRecord =
    state.connected &&
    !state.connecting &&
    state.animation === 'live2d' &&
    !privateView &&
    state.voiceInput &&
    state.voicePreview === 'idle';
  const voicePending = state.recording !== 'idle' || state.voicePreview === 'transcribing';
  const suggestions = conversationSuggestions(state, !userTurnSeen.current);
  const progressActions = state.story.actions.filter(
    (action) => action.kind === 'talk' || action.kind === 'choose',
  );
  const openingText = state.opening?.text ?? host.location.description;
  const stageLocation = scene.location(state.story.shot?.location ?? state.story.location);
  const stageWidth = stageElement.current?.getBoundingClientRect().width ?? 0;
  const actorX = parseFloat(host.point(stageLocation.x, 0).left);
  const narrativeSide = stageWidth && actorX > stageWidth / 2 ? 'left' : 'right';
  const activity =
    state.recording === 'permission'
      ? '需要麦克风权限'
      : state.recording === 'recording'
        ? '录音中'
        : state.voicePreview === 'transcribing'
          ? '正在识别语音'
          : state.interaction === 'speaking'
            ? '语音播放中'
            : busy
              ? `${scene.speaker}想了想…`
              : '';
  const chatEntries = useMemo(() => {
    const entries: StoryLogEntry[] = [];
    for (const line of log) {
      if (line.kind === 'narration') continue;
      const previous = entries.at(-1);
      if (
        line.kind === 'speech' &&
        previous?.kind === 'speech' &&
        line.messageId === previous.messageId
      )
        previous.text += '\n' + line.text;
      else entries.push({ ...line });
    }
    return entries.slice(-6);
  }, [log]);

  function perform(action: StoryAction, draft?: string) {
    const current = host.getSnapshot();
    const accepted = currentStoryAction(current, action.id, state.story.revision);
    if (!accepted || host.isDisposed) return;
    setPanel(null);
    setExploring(false);
    userTurnSeen.current = true;
    const messageId = host.controller.interact(
      {
        kind: 'action',
        actionId: accepted.id,
        revision: current.story.revision,
      },
      !!draft,
    );
    if (draft) {
      followLog.current = true;
      setLog((entries) =>
        retainReading([
          ...entries,
          { id: ++logId.current, kind: 'user' as const, text: draft, messageId },
        ]),
      );
    }
  }
  function editDraft(value: string) {
    host.controller.images.inputChanged();
    draftText.current = value;
    host.api.persistence?.write('draft', value);
    setDraft(value);
  }
  function send(value = draftText.current) {
    const current = host.getSnapshot();
    const text = value.trim();
    if (
      !text ||
      host.isDisposed ||
      !canSubmitConversation(current) ||
      (current.story.shot && current.story.shot.mode !== 'shared')
    )
      return;
    const messageId = host.controller.send(text);
    if (!messageId) return;
    userTurnSeen.current = true;
    followLog.current = true;
    setLog((entries) =>
      retainReading([...entries, { id: ++logId.current, kind: 'user' as const, text, messageId }]),
    );
    editDraft('');
  }
  function sendSuggestion(candidate: ReplySuggestion) {
    if (host.isDisposed || (draftText.current.trim() && !privateView)) return;
    const text = selectedConversationReply(
      host.getSnapshot(),
      suggestions,
      candidate,
      !userTurnSeen.current,
    );
    if (!text) return;
    // LLM recommendations are speech, never pre-bound executable story commands.
    send(text);
  }
  function stop() {
    finishRecordingGesture();
    host.controller.interrupt();
  }
  function newStory() {
    if (host.getSnapshot().reloadRequired) {
      window.location.reload();
      return;
    }
    finishRecordingGesture();
    setPanel(null);
    setExploring(false);
    host.api.persistence?.clearReading();
    editDraft('');
    setLog([]);
    userTurnSeen.current = false;
    openingSeen.current = undefined;
    seenText.current = { subtitle: '', narration: '' };
    host.newStory();
  }
  function startRecording() {
    const current = host.getSnapshot();
    if (
      host.isDisposed ||
      !current.voiceInput ||
      !current.connected ||
      current.animation === 'loading' ||
      current.recording !== 'idle' ||
      current.voicePreview !== 'idle'
    )
      return;
    host.controller.press();
  }
  function cancelRecording() {
    finishRecordingGesture();
    host.controller.cancelRecording();
  }
  function finishRecordingGesture() {
    pointer.current = undefined;
    recordingGesture.current?.finish();
    recordingGesture.current = undefined;
  }
  function discardDraft() {
    host.controller.discardVoicePreview();
    editDraft('');
  }

  return (
    <main className="story-app">
      <header className="story-header">
        <div className="story-brand">
          <span aria-hidden="true">✳</span>
          <span>{PLATFORM_NAME}</span>
        </div>
        <div className="story-header-actions">
          <nav className="experience-switch" aria-label="页面版本切换">
            <a href="/">原版对话</a>
            <span aria-current="page">WebGAL 故事</span>
          </nav>
          <button
            className="story-icon-button"
            aria-label="故事菜单"
            title="故事菜单"
            disabled={voicePending}
            onClick={() => setPanel('menu')}
          >
            <StoryIcon name="menu" />
          </button>
        </div>
      </header>
      <section
        ref={stageElement}
        className="story-stage"
        aria-label={`${stageLocation.label}，${CHARACTERS[host.characterId].label}`}
      >
        <div id="pixiContianer" data-fit="cover" />
        <div className="stage-vignette" aria-hidden="true" />
        {stageLocation.visible && state.story.shot?.mode !== 'blackout' && (
          <div
            className="stage-character-identity"
            style={{
              left: `clamp(90px, ${host.point(stageLocation.x, 0).left}, calc(100% - 90px))`,
            }}
          >
            <span>{scene.speaker}</span>
            {scene.speakerDescription && <small>{scene.speakerDescription}</small>}
          </div>
        )}
        <div className="stage-toolbar">
          <div className="location-control">
            <span className="location-icon">
              <StoryIcon name="location" />
            </span>
            <span>
              <h1>{stageLocation.label}</h1>
            </span>
          </div>
          {privateView && (
            <span
              className="stage-view-notice"
              role="status"
              aria-label={
                state.story.shot?.mode === 'character'
                  ? `${scene.speaker}的独处片段，你仍在原处等候`
                  : '剧情留白，可选择继续或结束'
              }
            >
              {state.story.shot?.mode === 'character' ? `${scene.speaker} · 独处中` : '剧情留白'}
            </span>
          )}
          {(progressActions.length > 0 || groups.observations.length > 0) &&
            !state.documentTitle && (
              <button
                className={`observe-control ${exploring ? 'is-active' : ''}`}
                aria-label="当前剧情的下一步"
                aria-expanded={exploring}
                disabled={!canAct}
                onClick={() => {
                  setExploring((value) => !value);
                }}
              >
                <StoryIcon name={exploring ? 'close' : 'observe'} />
                <span>{exploring ? '收起' : '下一步'}</span>
                {!exploring && <small>{progressActions.length}</small>}
              </button>
            )}
        </div>
        {exploring && canAct && !state.documentTitle && (
          <div className="scene-observations" aria-label="当前剧情机会与可选物件">
            <div className="observation-list story-progress-actions">
              <p className="chat-narration">继续当前环节，也可以留在这里自由聊。</p>
              {progressActions.map((action) => (
                <button key={action.id} onClick={() => perform(action)}>
                  <StoryIcon name="arrow" />
                  <span>{action.label}</span>
                </button>
              ))}
              {groups.observations.length > 0 && (
                <>
                  <p className="chat-narration">场景物件 · 可选</p>
                  {groups.observations.map((action) => (
                    <button key={action.id} onClick={() => perform(action)}>
                      <StoryIcon name="observe" />
                      <span>{action.label}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        )}
        {state.documentTitle && (
          <div className="document-toolbar">
            <button className="story-secondary" onClick={() => setPanel('document')}>
              <StoryIcon name="book" />
              阅读文字
            </button>
            <button
              className="story-icon-button"
              aria-label="收起资料"
              title="收起资料"
              onClick={() => {
                setPanel(null);
                host.presentation?.dismiss();
              }}
            >
              <StoryIcon name="close" />
            </button>
          </div>
        )}
        {state.animation === 'live2d' && !state.documentTitle && !exploring && (
          <StageNarrative
            caption={state.narration}
            speaker={scene.speaker}
            side={narrativeSide}
            solitary={!stageLocation.visible || state.story.shot?.mode === 'blackout'}
          />
        )}
        {state.animation !== 'live2d' && (
          <div className="stage-loading" role="status">
            {state.animation === 'loading' ? (
              <>
                <span className="story-spinner" />
                <p>正在布置场景</p>
              </>
            ) : (
              <>
                <span className="stage-failure-mark">
                  <StoryIcon name="refresh" />
                </span>
                <h2>{state.animation === 'failed' ? '角色加载失败' : '舞台显示已暂停'}</h2>
                <p>保留已经确认的故事，重新加载后继续。</p>
                <button
                  className="story-primary"
                  onClick={() => {
                    void host.rebuildStage();
                  }}
                >
                  重新加载场景 <StoryIcon name="refresh" />
                </button>
                <button className="story-text-button" onClick={() => setPanel('menu')}>
                  更换角色外观
                </button>
              </>
            )}
          </div>
        )}
      </section>
      <section className="story-content" aria-label="持续对话">
        {(state.reloadRequired ||
          state.sessionExpired ||
          (state.failure && state.playback !== 'audio-error' && state.animation === 'live2d')) && (
          <div className="story-error" role="alert">
            <p>
              {state.failure ||
                (state.reloadRequired
                  ? '场景版本与服务端不一致，请刷新页面后重试。'
                  : '会话已结束，请重新开始。')}
            </p>
            <button
              className={
                state.reloadRequired || state.sessionExpired ? 'story-primary' : 'story-text-button'
              }
              disabled={state.connecting}
              onClick={() =>
                state.reloadRequired
                  ? window.location.reload()
                  : state.sessionExpired
                    ? newStory()
                    : host.reconnect()
              }
            >
              {state.reloadRequired ? '刷新页面' : state.sessionExpired ? '重新开始' : '重新连接'}
            </button>
          </div>
        )}
        {state.playback === 'audio-error' && (
          <div className="audio-recovery">
            <span>声音暂不可用</span>
            <button
              className="story-text-button"
              onClick={() => {
                void host.playback.retryAudio();
              }}
            >
              重试声音
            </button>
            <button
              className="story-secondary"
              onClick={() => {
                void host.playback.useText();
              }}
            >
              阅读台词
            </button>
          </div>
        )}
        {state.playback === 'text' && (
          <button
            className="story-primary continue-story"
            onClick={() => {
              void host.playback.continueText();
            }}
          >
            下一句 <StoryIcon name="arrow" />
          </button>
        )}
        <section className="story-conversation" aria-label={`与${scene.speaker}对话`}>
          {privateView && (
            <>
              <div className="next-replies" aria-label="片段中的其他选择">
                {progressActions
                  .filter(
                    (action) =>
                      !suggestions.some(
                        (item) =>
                          item.interaction?.kind === 'action' &&
                          item.interaction.actionId === action.id,
                      ),
                  )
                  .map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      disabled={!canAct}
                      onClick={() => perform(action)}
                    >
                      {action.label}
                    </button>
                  ))}
              </div>
            </>
          )}
          <div
            ref={chatLog}
            className="conversation-log"
            role="log"
            aria-label="近期对话"
            aria-live="polite"
            onScroll={() => {
              const element = chatLog.current;
              if (element)
                followLog.current =
                  element.scrollHeight - element.scrollTop - element.clientHeight < 32;
              host.controller.images.gate({ reading: !followLog.current });
            }}
          >
            {chatEntries.length ? (
              chatEntries.map((entry) => (
                <div key={entry.id} className={`chat-line chat-${entry.kind}`}>
                  {entry.shareId && state.imageShares[entry.shareId] ? (
                    <ImageShareCard
                      share={state.imageShares[entry.shareId]!}
                      coordinator={host.controller.images}
                    />
                  ) : (
                    <span>{entry.text}</span>
                  )}
                  {entry.kind === 'user' && entry.messageId && (
                    <MessageStatus
                      message={state.outgoing.find(
                        (message) => message.messageId === entry.messageId,
                      )}
                      retrying={state.retryingMessageId === entry.messageId}
                      canRetry={
                        !state.retryingMessageId && host.controller.canRetry(entry.messageId)
                      }
                      onRetry={() => {
                        followLog.current = true;
                        void host.controller.retry(entry.messageId!);
                      }}
                    />
                  )}
                </div>
              ))
            ) : (
              <p className="chat-context">{openingText}</p>
            )}
            {activity && (
              <span className="chat-activity" role="status">
                <span className="activity-mark" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                {activity}
              </span>
            )}
          </div>
          {state.imageItems
            .filter(
              (item) =>
                state.imageShares[item.shareId] &&
                !chatEntries.some((entry) => entry.shareId === item.shareId),
            )
            .map((item) => (
              <button
                key={item.shareId}
                type="button"
                className="image-share-shortcut"
                onClick={() => setPanel('history')}
              >
                纪念照状态 · 查看原卡
              </button>
            ))}
          {suggestions.length > 0 && (!draft.trim() || privateView) && (
            <div className="next-replies" aria-label="推荐的下一句话，点击发送">
              {suggestions.map((candidate) => (
                <button
                  key={candidate.draft}
                  type="button"
                  onClick={() => sendSuggestion(candidate)}
                >
                  {candidate.draft}
                </button>
              ))}
            </div>
          )}
          {state.voicePreview === 'ready' && (
            <div className="voice-draft-label">
              <span>{state.voiceDraftSimulated ? '示例转录 · 待确认' : '语音草稿 · 待确认'}</span>
              <button
                className="story-icon-button"
                aria-label="取消语音草稿"
                onClick={discardDraft}
              >
                <StoryIcon name="close" />
              </button>
            </div>
          )}
          {state.voiceInputError && (
            <p className="voice-input-error" role="alert">
              {state.voiceInputError}
            </p>
          )}
          <form
            className={`story-composer ${state.recording === 'recording' ? 'is-recording' : ''}`}
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            {(state.voiceInput || inputMode === 'voice') && (
              <button
                type="button"
                className="story-icon-button input-mode-switch"
                aria-label={inputMode === 'text' ? '切换语音输入' : '切换文字输入'}
                title={inputMode === 'text' ? '语音输入' : '文字输入'}
                disabled={
                  voicePending ||
                  (inputMode === 'text' && (!state.voiceInput || state.voicePreview !== 'idle'))
                }
                onClick={() => {
                  focusText.current = true;
                  setInputMode((mode) => (mode === 'text' ? 'voice' : 'text'));
                }}
              >
                <StoryIcon name={inputMode === 'text' ? 'mic' : 'keyboard'} />
              </button>
            )}
            {inputMode === 'text' ? (
              <>
                <label className="sr-only" htmlFor="story-input">
                  和{scene.speaker}说话
                </label>
                <textarea
                  id="story-input"
                  ref={input}
                  onCompositionStart={() => host.controller.images.gate({ composing: true })}
                  onCompositionEnd={() => host.controller.images.gate({ composing: false })}
                  value={draft}
                  rows={1}
                  maxLength={1000}
                  onChange={(event) => editDraft(event.target.value)}
                  placeholder={state.voicePreview === 'ready' ? '编辑语音草稿…' : '写下你想说的话…'}
                  disabled={!canChat}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      send();
                    }
                  }}
                />
                {busy && !draft.trim() ? (
                  <button
                    type="button"
                    className="story-stop-button"
                    aria-label="停止当前演出"
                    onClick={stop}
                  >
                    <StoryIcon name="stop" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="send-button"
                    aria-label={state.voicePreview === 'ready' ? '确认发送语音草稿' : '发送消息'}
                    disabled={!canChat || !draft.trim()}
                  >
                    <StoryIcon name="send" />
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="record-button"
                  aria-label="按住录音，松开后预览识别文字"
                  disabled={!canRecord}
                  onContextMenu={(event) => {
                    // A recording hold must not open native menus or reach WebGAL's right-click hotkey.
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onPointerDown={(event) => {
                    if (
                      event.button !== 0 ||
                      !event.isPrimary ||
                      !canRecord ||
                      pointer.current !== undefined ||
                      host.getSnapshot().recording !== 'idle'
                    )
                      return;
                    event.preventDefault();
                    recordingGesture.current = protectRecordingGesture(event.currentTarget);
                    pointer.current = event.pointerId;
                    pressY.current = event.clientY;
                    try {
                      event.currentTarget.setPointerCapture(event.pointerId);
                    } catch {
                      recordingGesture.current.dispose();
                      recordingGesture.current = undefined;
                      pointer.current = undefined;
                      return;
                    }
                    startRecording();
                  }}
                  onPointerUp={(event) => {
                    if (event.pointerId !== pointer.current) return;
                    finishRecordingGesture();
                    if (event.currentTarget.hasPointerCapture(event.pointerId))
                      event.currentTarget.releasePointerCapture(event.pointerId);
                    host.controller.release();
                  }}
                  onPointerCancel={(event) => {
                    if (event.pointerId === pointer.current) cancelRecording();
                  }}
                  onLostPointerCapture={(event) => {
                    if (event.pointerId !== pointer.current) return;
                    const wasHeld = pointer.current !== undefined;
                    finishRecordingGesture();
                    if (wasHeld && host.getSnapshot().recording !== 'idle')
                      host.controller.cancelRecording();
                  }}
                  onPointerMove={(event) => {
                    if (event.pointerId === pointer.current && pressY.current - event.clientY > 70)
                      cancelRecording();
                  }}
                  onKeyDown={(event) => {
                    if ([' ', 'Enter'].includes(event.key)) {
                      event.preventDefault();
                      if (!event.repeat) startRecording();
                    }
                  }}
                  onKeyUp={(event) => {
                    if ([' ', 'Enter'].includes(event.key)) {
                      event.preventDefault();
                      host.controller.release();
                    }
                  }}
                >
                  {state.recording === 'recording'
                    ? '松开识别'
                    : state.recording === 'permission'
                      ? '等待麦克风授权'
                      : state.voicePreview === 'transcribing'
                        ? '识别中…'
                        : '按住录音'}
                </button>
                {busy && state.recording === 'idle' && state.voicePreview === 'idle' && (
                  <button
                    type="button"
                    className="story-stop-button"
                    aria-label="停止当前演出"
                    onClick={stop}
                  >
                    <StoryIcon name="stop" />
                  </button>
                )}
              </>
            )}
          </form>
        </section>
      </section>
      <StoryPanels
        panel={panel}
        state={state}
        host={host}
        navigation={groups.navigation}
        canAct={canAct}
        log={log}
        onClose={() => setPanel(null)}
        onOpen={setPanel}
        onAction={perform}
        onRestart={newStory}
      />
    </main>
  );
}
