/**
 * Per-session serial async queue.
 * Enqueued tasks execute one at a time, in order.
 * Callers await their own result.
 */
export class SessionQueue {
  private queues = new Map<string, Promise<void>>();

  /**
   * Enqueue a task for the given session key.
   * Returns the task's result after it completes.
   * Tasks for the same key run serially; different keys run concurrently.
   */
  async enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(key) ?? Promise.resolve();

    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const result = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const chain = prev.then(async () => {
      try {
        resolve(await task());
      } catch (err) {
        reject(err);
      }
    });

    // Update the chain (ignore errors to keep queue alive)
    this.queues.set(key, chain.catch(() => {}));

    return result;
  }

  /** Remove a session's queue (on session cleanup). */
  remove(key: string): void {
    this.queues.delete(key);
  }

  dispose(): void {
    this.queues.clear();
  }
}
