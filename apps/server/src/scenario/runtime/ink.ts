import { Story } from 'inkjs';
import { createHash } from 'node:crypto';
import type { Choice } from 'inkjs/engine/Choice';
import { z } from 'zod';
import {
  FactsSchema,
  ActionSchema,
  EmotionSchema,
  StoryStateSchema,
  StoryActionSchema,
  PresentationEventSchema,
  type StoryInteraction,
  type StoryAction,
  type ReplySuggestion,
} from '@mira/protocol';
import { AppError } from '../../http/errors.js';
import type { StoryBeat, StoryCheckpoint, StoryFrame } from '../ports.js';

export interface InkContent {
  id: string;
  entry: string;
  entries: Record<'story' | 'conversation', string>;
  version: string;
  hash: string;
  bytecode: unknown;
  phases: readonly string[];
  actionDescriptions: Record<string, string>;
  recommendations?: { decisionPhases: readonly string[]; maxGuiding: number };
  playerReplies?: Record<string, string>;
  projection: {
    flags: string[];
    revealed: Record<string, string>;
    facts: Record<string, string>;
  };
  directorNotes: Array<{
    requires?: string[];
    locations?: string[];
    text: string;
    replyActions?: string[];
    chatReplies?: string[];
  }>;
  voices: Record<string, { text: string; emotion: string; action: string }>;
  presentation: {
    character: string;
    environment: { default: string; variants: Array<{ requires: string[]; value: string }> };
  };
  resourceIds: readonly string[];
  locations: readonly string[];
  ambiences: readonly string[];
  endings: readonly string[];
  documents: Array<{ id: string; title?: string; text: string; requires: string[] }>;
}

/** Each proposal owns its interpreter; only receipt-confirmed checkpoints become authoritative. */
export class InkScenario {
  constructor(private readonly content: InkContent) {}
  private story(checkpoint?: StoryCheckpoint): Story {
    const story = new Story(JSON.stringify(this.content.bytecode));
    story.onError = () => {
      throw new AppError('INVALID_PLAN', 500, '故事暂时没有准备好，请重新开始。');
    };
    if (checkpoint) {
      if (
        checkpoint.storyId !== this.content.id ||
        checkpoint.version !== this.content.version ||
        checkpoint.artifactHash !== this.content.hash
      )
        throw new AppError('SESSION_EXPIRED', 410, '故事版本已更新，请重新开始会话。', true);
      story.state.LoadJson(checkpoint.state);
    }
    return story;
  }
  private menu(story: Story) {
    story.ChoosePathString(this.content.entry);
    let steps = 0;
    while (story.canContinue) {
      if (++steps > 8) throw new AppError('INVALID_PLAN', 500, '故事菜单没有准备好。');
      if (story.Continue()?.trim())
        throw new AppError('INVALID_PLAN', 500, '故事菜单包含未确认演出。');
    }
  }
  private checkpoint(story: Story, revision: number): StoryCheckpoint {
    // Normalizing a copy to the menu keeps a partial ending interruptible and never auto-resumes it.
    const copy = this.story();
    copy.state.LoadJson(story.state.ToJson());
    this.menu(copy);
    return {
      storyId: this.content.id,
      version: this.content.version,
      artifactHash: this.content.hash,
      revision,
      state: copy.state.ToJson(),
    };
  }
  initial(entry: 'story' | 'conversation' = 'story'): StoryCheckpoint {
    const story = this.story();
    story.ChoosePathString(this.content.entries[entry]);
    let steps = 0;
    while (story.canContinue) {
      if (++steps > 8 || story.Continue()?.trim())
        throw new AppError('INVALID_PLAN', 500, '故事入口包含未确认演出。');
    }
    return this.checkpoint(story, 0);
  }
  private read(story: Story, name: string): unknown {
    return story.variablesState.$(name);
  }
  private actions(story: Story): StoryAction[] {
    return story.currentChoices.map((choice: Choice) => {
      const id = choice.tags
        ?.map((tag) => tag.trim())
        .find((tag: string) => tag.startsWith('action:'))
        ?.slice(7);
      if (!id) throw new AppError('INVALID_PLAN', 500, '故事选项缺少动作标识。');
      return StoryActionSchema.parse({
        id,
        label: choice.text.trim(),
        description: this.content.actionDescriptions[id] ?? choice.text.trim(),
        kind: id?.split('-')[0],
        explicit: choice.tags?.some((tag) => tag.trim() === 'explicit') ?? false,
      });
    });
  }
  frame(checkpoint: StoryCheckpoint): StoryFrame {
    const story = this.story(checkpoint);
    this.menu(story);
    const knownFlags = new Set(
      this.content.projection.flags.filter((name) => z.boolean().parse(this.read(story, name))),
    );
    const revealed: string[] = [];
    for (const [id, flag] of Object.entries(this.content.projection.revealed))
      if (knownFlags.has(flag)) revealed.push(id);
    const phase = z
      .number()
      .int()
      .min(0)
      .max(this.content.phases.length - 1)
      .parse(this.read(story, 'phase'));
    const state = StoryStateSchema.parse({
      location: this.read(story, 'location'),
      ambience: this.read(story, 'ambience'),
      ending: this.read(story, 'ending') || null,
      revealed,
      phase: this.content.phases[phase],
      revision: checkpoint.revision,
      actions: this.actions(story),
      milestones: [...knownFlags],
    });
    for (const [value, allowed] of [
      [state.location, this.content.locations],
      [state.ambience, this.content.ambiences],
      [state.ending, this.content.endings],
    ] as const) {
      if (value && allowed && !allowed.includes(value))
        throw new AppError('INVALID_PLAN', 500, '故事投影引用了未声明的内容。');
    }
    return {
      story: state,
      recommendationPolicy: this.content.recommendations,
      facts: FactsSchema.parse(
        Object.fromEntries(
          Object.entries(this.content.projection.facts).map(([id, flag]) => [
            id,
            knownFlags.has(flag),
          ]),
        ),
      ),
      ...(this.content.presentation
        ? {
            presentation: {
              character: this.content.presentation.character,
              environment:
                this.content.presentation.environment.variants.find((variant) =>
                  variant.requires.every((flag) => knownFlags.has(flag)),
                )?.value ?? this.content.presentation.environment.default,
            },
          }
        : {}),
      known: this.content.documents
        .filter((entry) => entry.requires.every((name) => knownFlags.has(name)))
        .map(({ id, text }) => ({ id, text })),
      directorNote:
        this.content.directorNotes.find(
          (note) =>
            (note.requires ?? []).every((name) => knownFlags.has(name)) &&
            (!note.locations || note.locations.includes(state.location)),
        )?.text ?? '',
    };
  }
  suggestions(checkpoint: StoryCheckpoint): ReplySuggestion[] {
    const frame = this.frame(checkpoint);
    const known = new Set(frame.story.milestones);
    const note = this.content.directorNotes.find(
      (item) =>
        (item.requires ?? []).every((flag) => known.has(flag)) &&
        (!item.locations || item.locations.includes(frame.story.location)),
    );
    const guided = (note?.replyActions ?? [])
      .flatMap((id) => {
        const draft = this.content.playerReplies?.[id];
        if (!draft || !frame.story.actions.some((action) => action.id === id)) return [];
        return [
          {
            label: draft.length > 20 ? draft.slice(0, 19) + '…' : draft,
            draft,
            interaction: { kind: 'action' as const, actionId: id, revision: checkpoint.revision },
          },
        ];
      })
      .slice(0, this.content.recommendations?.maxGuiding ?? 1);
    const chat = (note?.chatReplies ?? []).map((draft) => ({
      label: draft.length > 20 ? draft.slice(0, 19) + '…' : draft,
      draft,
    }));
    return [...guided, ...chat].slice(0, 3);
  }

  propose(input: StoryInteraction | string, checkpoint: StoryCheckpoint): StoryBeat[] {
    if (
      typeof input !== 'string' &&
      input.kind === 'action' &&
      input.revision !== checkpoint.revision
    )
      throw new AppError('STALE_TURN', 409, '这里的选择已更新，请重新选择。', true);
    const actionId =
      typeof input === 'string'
        ? input
        : input.kind === 'action'
          ? input.actionId
          : input.kind === 'move'
            ? `move-${input.location}`
            : input.kind === 'inspect'
              ? `inspect-${input.prop}`
              : `choose-${input.ending}`;
    const story = this.story(checkpoint);
    this.menu(story);
    const choice = story.currentChoices.find((item: Choice) =>
      item.tags?.some((tag) => tag.trim() === `action:${actionId}`),
    );
    if (!choice)
      throw new AppError(
        'INVALID_REQUEST',
        400,
        '现在还不能这样做，可以继续聊聊或选择当前的互动。',
        true,
      );
    story.ChooseChoiceIndex(choice.index);
    const beats: StoryBeat[] = [];
    let steps = 0;
    let parent = checkpoint;
    while (story.canContinue) {
      if (++steps > 32 || beats.length >= 10)
        throw new AppError('INVALID_PLAN', 500, '故事片段过长。');
      const caption = story.Continue()?.trim() ?? '';
      if (!caption) continue;
      if (caption.length > 240) throw new AppError('INVALID_PLAN', 500, '故事片段过长。');
      const tags: string[] = (story.currentTags ?? []).map((tag: string) => tag.trim());
      const cues = tags.filter((tag) => tag.startsWith('cue:'));
      if (cues.length !== 1) throw new AppError('INVALID_PLAN', 500, '故事片段缺少呈现锚点。');
      const [, type, value] = cues[0]!.split(':');
      const id = tags.find((tag: string) => tag.startsWith('voice:'))?.slice(6);
      const next = this.checkpoint(story, checkpoint.revision + beats.length + 1);
      next.parentHash = createHash('sha256').update(parent.state).digest('hex');
      parent = next;
      let event: Record<string, unknown>;
      if (type === 'location') event = { type, location: value };
      else if (type === 'prop') {
        const document = this.content.documents.find((item) => item.id === value);
        if (!document?.title) throw new AppError('INVALID_PLAN', 500, '资料没有准备好。');
        event = { type, prop: value, document: { title: document.title, text: document.text } };
      } else if (type === 'ambience') event = { type, ambience: value };
      else if (type === 'ending') event = { type, ending: value };
      else if (type === 'environment') event = { type, environment: value };
      else if (type === 'photo') event = { type, resourceId: value };
      else event = { type, beatId: value };
      if (
        type === 'photo' &&
        this.content.resourceIds &&
        !this.content.resourceIds.includes(value!)
      )
        throw new AppError('INVALID_PLAN', 500, '未声明的媒体资源。');
      if (type === 'location' && this.content.locations && !this.content.locations.includes(value!))
        throw new AppError('INVALID_PLAN', 500, '未声明的地点。');
      if (type === 'ambience' && this.content.ambiences && !this.content.ambiences.includes(value!))
        throw new AppError('INVALID_PLAN', 500, '未声明的环境状态。');
      if (type === 'ending' && this.content.endings && !this.content.endings.includes(value!))
        throw new AppError('INVALID_PLAN', 500, '未声明的结局。');
      if (
        type === 'environment' &&
        this.content.presentation &&
        ![
          this.content.presentation.environment.default,
          ...this.content.presentation.environment.variants.map((item) => item.value),
        ].includes(value!)
      )
        throw new AppError('INVALID_PLAN', 500, '未声明的环境预设。');
      const parsed = PresentationEventSchema.parse({ ...event, eventId: 'validated' });
      const { eventId: _eventId, ...cue } = parsed;
      const line = id ? this.content.voices[id] : undefined;
      if (id && !line) throw new AppError('INVALID_PLAN', 500, '台词没有准备好。');
      beats.push({
        caption,
        event: cue,
        checkpoint: next,
        frame: this.frame(next),
        ...(line
          ? {
              line: {
                text: line.text,
                emotion: EmotionSchema.parse(line.emotion),
                action: ActionSchema.parse(line.action),
              },
            }
          : {}),
      });
    }
    if (!beats.length) throw new AppError('INVALID_PLAN', 500, '故事没有可呈现的结果。');
    if (beats.filter((beat) => beat.line).length > 4)
      throw new AppError('INVALID_PLAN', 500, '故事语音片段超过本轮预算。');
    return beats;
  }
  accept(current: StoryCheckpoint, next: StoryCheckpoint): StoryCheckpoint {
    this.story(next);
    if (
      next.revision !== current.revision + 1 ||
      next.parentHash !== createHash('sha256').update(current.state).digest('hex')
    )
      throw new AppError('STALE_TURN', 409, '故事进度已更新，不能应用旧的结果。', true);
    return next;
  }
}
