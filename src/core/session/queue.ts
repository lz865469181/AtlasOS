/**
 * Per-session serial async queue.
 * Enqueued tasks execute one at a time, in order.
 */
export class SessionQueue {
  private queues = new Map<string, Promise<void>>();

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

    this.queues.set(key, chain.catch(() => {}));
    return result;
  }

  remove(key: string): void {
    this.queues.delete(key);
  }

  dispose(): void {
    this.queues.clear();
  }
}
