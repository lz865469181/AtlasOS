import { describe, it, expect } from "vitest";
import { SessionQueue } from "./queue.js";

describe("SessionQueue", () => {
  it("executes tasks in order for same key", async () => {
    const queue = new SessionQueue();
    const order: number[] = [];

    await Promise.all([
      queue.enqueue("s1", async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push(1);
      }),
      queue.enqueue("s1", async () => {
        order.push(2);
      }),
      queue.enqueue("s1", async () => {
        order.push(3);
      }),
    ]);

    expect(order).toEqual([1, 2, 3]);
    queue.dispose();
  });

  it("executes tasks concurrently for different keys", async () => {
    const queue = new SessionQueue();
    const order: string[] = [];

    await Promise.all([
      queue.enqueue("a", async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push("a");
      }),
      queue.enqueue("b", async () => {
        order.push("b");
      }),
    ]);

    // "b" should finish before "a" since they're independent
    expect(order[0]).toBe("b");
    expect(order[1]).toBe("a");
    queue.dispose();
  });

  it("returns the task result", async () => {
    const queue = new SessionQueue();
    const result = await queue.enqueue("s1", async () => 42);
    expect(result).toBe(42);
    queue.dispose();
  });

  it("propagates task errors", async () => {
    const queue = new SessionQueue();
    await expect(
      queue.enqueue("s1", async () => { throw new Error("boom"); }),
    ).rejects.toThrow("boom");
    queue.dispose();
  });

  it("continues processing after a failed task", async () => {
    const queue = new SessionQueue();

    // First task fails
    await queue.enqueue("s1", async () => { throw new Error("fail"); }).catch(() => {});

    // Second task should still run
    const result = await queue.enqueue("s1", async () => "ok");
    expect(result).toBe("ok");
    queue.dispose();
  });

  it("remove clears the queue for a key", () => {
    const queue = new SessionQueue();
    queue.remove("s1"); // Should not throw even if key doesn't exist
    queue.dispose();
  });
});
