import { describe, it, expect } from 'vitest';
import { SessionQueue, sessionKey } from './SessionQueue.js';

describe('SessionQueue', () => {
  it('runs tasks for the same key serially', async () => {
    const queue = new SessionQueue();
    const order: number[] = [];

    const task = (id: number, delayMs: number) => () =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          order.push(id);
          resolve();
        }, delayMs);
      });

    const p1 = queue.enqueue('a', task(1, 30));
    const p2 = queue.enqueue('a', task(2, 20));
    const p3 = queue.enqueue('a', task(3, 10));
    await Promise.all([p1, p2, p3]);

    expect(order).toEqual([1, 2, 3]);
  });

  it('runs tasks for different keys in parallel', async () => {
    const queue = new SessionQueue();
    const order: string[] = [];

    const p1 = queue.enqueue('a', async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push('a');
    });
    const p2 = queue.enqueue('b', async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push('b');
    });
    await Promise.all([p1, p2]);

    expect(order).toEqual(['b', 'a']);
  });

  it('returns the task result', async () => {
    const queue = new SessionQueue();
    const result = await queue.enqueue('k', async () => 42);
    expect(result).toBe(42);
  });

  it('propagates task errors without blocking subsequent tasks', async () => {
    const queue = new SessionQueue();
    const order: number[] = [];

    const p1 = queue.enqueue('k', async () => {
      order.push(1);
      throw new Error('fail');
    });
    const p2 = queue.enqueue('k', async () => {
      order.push(2);
    });

    await expect(p1).rejects.toThrow('fail');
    await p2;
    expect(order).toEqual([1, 2]);
  });

  it('remove() clears a key', async () => {
    const queue = new SessionQueue();
    await queue.enqueue('k', async () => {});
    expect(queue.has('k')).toBe(true);
    queue.remove('k');
    expect(queue.has('k')).toBe(false);
  });

  it('dispose() clears all keys', async () => {
    const queue = new SessionQueue();
    await queue.enqueue('a', async () => {});
    await queue.enqueue('b', async () => {});
    queue.dispose();
    expect(queue.has('a')).toBe(false);
    expect(queue.has('b')).toBe(false);
  });
});

describe('sessionKey', () => {
  it('returns chatId for events without threadId', () => {
    expect(sessionKey({ chatId: 'chat_123' })).toBe('chat_123');
  });

  it('returns chatId:threadId for events with threadId', () => {
    expect(sessionKey({ chatId: 'chat_123', threadId: 'thread_456' })).toBe('chat_123:thread_456');
  });
});
