/**
 * Per-key serial async queue.
 * Tasks for the same key execute FIFO, one at a time.
 * Tasks for different keys execute in parallel.
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

    // Store the chain but swallow rejections — they're delivered via `result`.
    this.queues.set(key, chain.catch(() => {}));

    return result;
  }

  has(key: string): boolean {
    return this.queues.has(key);
  }

  remove(key: string): void {
    this.queues.delete(key);
  }

  dispose(): void {
    this.queues.clear();
  }
}

/**
 * Derive a session queue key from a ChannelEvent-like object.
 * 1:1 chats use chatId. Group threads use chatId:threadId.
 */
export function sessionKey(event: { chatId: string; threadId?: string }): string {
  return event.threadId ? `${event.chatId}:${event.threadId}` : event.chatId;
}
