// Local host extension. See third-party/webgal/PATCHES.json.
export type EngineMode = 'story' | 'interactive';

/** Configure before importing Core. A page cannot switch owners of the same stage. */
export function createModePolicy() {
  let mode: EngineMode | undefined;
  return {
    configure(next: EngineMode): void {
      if (mode && mode !== next) throw new Error('WEBGAL_MODE_LOCKED');
      mode = next;
    },
    requireStory(operation: string): void {
      if (mode !== 'story') throw new Error(`WEBGAL_STORY_DISABLED:${operation}`);
    },
    requireInteractive(): void {
      if (mode !== 'interactive') throw new Error('WEBGAL_INTERACTIVE_NOT_CONFIGURED');
    },
  };
}

export const engineMode = createModePolicy();
