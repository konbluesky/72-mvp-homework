export interface EngineLease {
  readonly stageEpoch: number;
  dispose(): void;
}

export type EngineFactory<T extends EngineLease = EngineLease> = (
  signal: AbortSignal,
) => Promise<T>;

/** Owns one mount attempt. A late import cannot become the next mount's stage. */
export class EngineLifecycle<T extends EngineLease = EngineLease> {
  private attempt?: { controller: AbortController; operation: Promise<T> };
  private lease?: T;

  constructor(private readonly factory: EngineFactory<T>) {}

  initialize(): Promise<T> {
    if (this.attempt) return this.attempt.operation;
    const controller = new AbortController();
    const attempt = {
      controller,
      operation: Promise.resolve().then(async () => {
        controller.signal.throwIfAborted();
        const lease = await this.factory(controller.signal);
        if (controller.signal.aborted || this.attempt !== attempt) {
          lease.dispose();
          throw new DOMException('Engine mount superseded', 'AbortError');
        }
        this.lease = lease;
        return lease;
      }),
    };
    this.attempt = attempt;
    // Clear only this failed attempt; retry may already belong to a newer effect.
    void attempt.operation.catch(() => {
      if (this.attempt === attempt) this.attempt = undefined;
    });
    return attempt.operation;
  }

  dispose(): void {
    const attempt = this.attempt;
    this.attempt = undefined;
    attempt?.controller.abort();
    const lease = this.lease;
    this.lease = undefined;
    lease?.dispose();
  }
}
