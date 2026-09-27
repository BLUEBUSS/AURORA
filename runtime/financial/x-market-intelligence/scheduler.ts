export interface XMarketPulseSchedulerOptions {
  sync: () => Promise<void>;
  digest: () => Promise<void>;
  pollIntervalMs: number;
  digestIntervalMs: number;
  onError?: (error: unknown) => void;
}

export class XMarketPulseScheduler {
  private syncTimer: ReturnType<typeof setInterval> | undefined;
  private digestTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly options: XMarketPulseSchedulerOptions) {}

  start(): void {
    if (this.syncTimer || this.digestTimer) return;

    this.runSafely(this.options.sync);
    this.syncTimer = setInterval(
      () => this.runSafely(this.options.sync),
      Math.max(1, this.options.pollIntervalMs),
    );
    this.digestTimer = setInterval(
      () => this.runSafely(this.options.digest),
      Math.max(1, this.options.digestIntervalMs),
    );
    this.syncTimer.unref?.();
    this.digestTimer.unref?.();
  }

  stop(): void {
    if (this.syncTimer) clearInterval(this.syncTimer);
    if (this.digestTimer) clearInterval(this.digestTimer);
    this.syncTimer = undefined;
    this.digestTimer = undefined;
  }

  private runSafely(job: () => Promise<void>): void {
    void job().catch((error) => this.options.onError?.(error));
  }
}
