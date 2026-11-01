import type { StoryAction } from '@mira/protocol';
import type { InteractiveState } from '../../interaction/state';

/** Each server-issued action has exactly one home in the UI. No story rules live here. */
export function groupStoryActions(actions: readonly StoryAction[]) {
  const navigation: StoryAction[] = [];
  const observations: StoryAction[] = [];
  const decisions: StoryAction[] = [];
  const responses: StoryAction[] = [];
  const seen = new Set<string>();
  for (const action of actions) {
    if (seen.has(action.id)) continue;
    seen.add(action.id);
    switch (action.kind) {
      case 'move':
        navigation.push(action);
        break;
      case 'inspect':
      case 'view':
        observations.push(action);
        break;
      case 'choose':
        decisions.push(action);
        break;
      case 'talk':
        responses.push(action);
        break;
    }
  }
  return { navigation, observations, decisions, responses };
}

export function canUseStoryActions(state: InteractiveState): boolean {
  return (
    state.connected &&
    !state.connecting &&
    state.animation === 'live2d' &&
    state.interaction === 'idle' &&
    state.playback === 'idle' &&
    state.recording === 'idle' &&
    state.voicePreview === 'idle'
  );
}

export function currentStoryAction(state: InteractiveState, id: string, revision: number) {
  if (!canUseStoryActions(state) || state.story.revision !== revision) return undefined;
  return state.story.actions.find((action) => action.id === id);
}

export function canSubmitConversation(state: InteractiveState) {
  return (
    state.connected &&
    !state.connecting &&
    state.animation === 'live2d' &&
    state.recording === 'idle' &&
    state.voicePreview !== 'transcribing'
  );
}

/** Candidates belong to a rendered reply (or the untouched opening), never an old round. */
export function conversationSuggestions(state: InteractiveState, openingAllowed: boolean) {
  if (
    !canSubmitConversation(state) ||
    state.animation !== 'live2d' ||
    state.interaction !== 'idle' ||
    state.playback !== 'idle' ||
    state.voicePreview !== 'idle' ||
    state.failure
  )
    return [];
  if (state.suggestions.length) return state.suggestions;
  if (openingAllowed && state.opening?.revision === state.story.revision)
    return state.opening.suggestions;
  return [];
}
export function selectedConversationReply(
  state: InteractiveState,
  source: readonly import('@mira/protocol').ReplySuggestion[],
  candidate: import('@mira/protocol').ReplySuggestion,
  openingAllowed: boolean,
) {
  const current = conversationSuggestions(state, openingAllowed);
  return current === source && current.includes(candidate) ? candidate.draft : undefined;
}
