import { describe, expect, it } from 'vitest';
import type { StoryAction } from '@mira/protocol';
import { initialInteractiveState } from '../../interaction/state';
import {
  canUseStoryActions,
  currentStoryAction,
  groupStoryActions,
  canSubmitConversation,
  conversationSuggestions,
  selectedConversationReply,
} from './interaction-layout';

const action = (id: string, kind: StoryAction['kind']): StoryAction => ({
  id,
  kind,
  label: id,
  description: '',
  explicit: kind === 'choose',
});

describe('persistent conversation replies', () => {
  it('submits the exact suggested utterance only from the currently published reply', () => {
    const state = available();
    const candidate = { label: '看照片', draft: '可以给我看看那张照片吗？' };
    state.suggestions = [candidate];
    const shown = conversationSuggestions(state, false);
    expect(selectedConversationReply(state, shown, candidate, false)).toBe(candidate.draft);
    // PlaybackScheduler clears candidates synchronously on the first send, before React renders.
    state.suggestions = [];
    expect(selectedConversationReply(state, shown, candidate, false)).toBeUndefined();
    state.suggestions = [{ ...candidate }];
    expect(selectedConversationReply(state, shown, candidate, false)).toBeUndefined();
  });
  it('expires opening replies when the story changes or the player has spoken', () => {
    const state = available();
    state.opening = {
      text: '坐一会儿吗？',
      revision: 0,
      suggestions: [{ label: '好', draft: '陪你坐会儿。' }],
    };
    expect(conversationSuggestions(state, true)).toBe(state.opening.suggestions);
    expect(conversationSuggestions(state, false)).toEqual([]);
    state.story = { ...state.story, revision: 1 };
    expect(conversationSuggestions(state, true)).toEqual([]);
  });
  it('permits a new typed turn to interrupt while suggestions stay suppressed', () => {
    const state = { ...available(), interaction: 'speaking' as const, playback: 'audio' as const };
    expect(canSubmitConversation(state)).toBe(true);
    expect(conversationSuggestions(state, true)).toEqual([]);
    expect(canSubmitConversation({ ...state, recording: 'recording' })).toBe(false);
    expect(canSubmitConversation({ ...state, voicePreview: 'transcribing' })).toBe(false);
    expect(canSubmitConversation({ ...state, voicePreview: 'ready' })).toBe(true);
  });
  it('suppresses candidates on failed or unfinished presentation', () => {
    const state = available();
    state.suggestions = [{ label: '继续', draft: '然后呢？' }];
    expect(conversationSuggestions({ ...state, failure: '照片加载失败' }, false)).toEqual([]);
    expect(conversationSuggestions({ ...state, playback: 'buffering' }, false)).toEqual([]);
    expect(conversationSuggestions({ ...state, voicePreview: 'ready' }, false)).toEqual([]);
  });
});
const available = () => ({
  ...initialInteractiveState(),
  connected: true,
  animation: 'live2d' as const,
});

describe('story UI action ownership', () => {
  it('gives navigation, observation and narrative actions separate, non-overlapping surfaces', () => {
    const actions = [
      action('a', 'move'),
      action('b', 'inspect'),
      action('c', 'view'),
      action('d', 'talk'),
      action('e', 'choose'),
    ];
    const grouped = groupStoryActions(actions);
    expect(grouped.navigation.map((entry) => entry.id)).toEqual(['a']);
    expect(grouped.observations.map((entry) => entry.id)).toEqual(['b', 'c']);
    expect(grouped.responses.map((entry) => entry.id)).toEqual(['d']);
    expect(grouped.decisions.map((entry) => entry.id)).toEqual(['e']);
    expect(Object.values(grouped).flat()).toHaveLength(actions.length);
    expect(grouped.decisions[0]).toBe(actions[4]);
    expect(actions[4].explicit).toBe(true);
  });
  it('never duplicates a server action across different surfaces', () => {
    const first = action('same', 'inspect');
    const grouped = groupStoryActions([first, action('same', 'talk')]);
    expect(Object.values(grouped).flat()).toEqual([first]);
  });
  it('rejects stale action revisions even if the identifier remains available', () => {
    const state = available();
    state.story = { ...state.story, revision: 4, actions: [action('current', 'choose')] };
    expect(currentStoryAction(state, 'current', 3)).toBeUndefined();
    expect(currentStoryAction(state, 'removed', 4)).toBeUndefined();
    expect(currentStoryAction(state, 'current', 4)).toBe(state.story.actions[0]);
  });
  it('blocks story clicks during playback, recording and unconfirmed voice input', () => {
    const state = available();
    expect(canUseStoryActions(state)).toBe(true);
    expect(canUseStoryActions({ ...state, interaction: 'speaking' })).toBe(false);
    expect(canUseStoryActions({ ...state, playback: 'buffering' })).toBe(false);
    expect(canUseStoryActions({ ...state, playback: 'audio-error' })).toBe(false);
    expect(canUseStoryActions({ ...state, recording: 'permission' })).toBe(false);
    expect(canUseStoryActions({ ...state, voicePreview: 'transcribing' })).toBe(false);
    expect(canUseStoryActions({ ...state, voicePreview: 'ready' })).toBe(false);
    expect(canUseStoryActions({ ...state, animation: 'loading' })).toBe(false);
  });
});
