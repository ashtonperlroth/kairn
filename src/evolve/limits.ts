/**
 * Lightweight FIFO limiter for sharing a concurrency cap across independent
 * callers. Used by PBT so branch-local schedulers cannot multiply Claude task
 * concurrency by the number of active branches.
 */
export class AsyncLimiter {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  readonly maxConcurrency: number;

  constructor(maxConcurrency: number) {
    this.maxConcurrency = Math.max(1, Math.floor(maxConcurrency));
  }

  get activeCount(): number {
    return this.active;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.maxConcurrency) {
      this.active++;
      return;
    }

    await new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
      return;
    }
    this.active--;
  }
}
