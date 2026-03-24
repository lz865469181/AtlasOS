import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Scheduler } from "./scheduler.js";

describe("Scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers enabled tasks", () => {
    const scheduler = new Scheduler();
    scheduler.register({
      name: "test",
      schedule: "* * * * *",
      enabled: true,
      handler: async () => {},
    });
    expect(scheduler.size).toBe(1);
  });

  it("skips disabled tasks", () => {
    const scheduler = new Scheduler();
    scheduler.register({
      name: "disabled",
      schedule: "* * * * *",
      enabled: false,
      handler: async () => {},
    });
    expect(scheduler.size).toBe(0);
  });

  it("throws on invalid cron expression", () => {
    const scheduler = new Scheduler();
    expect(() =>
      scheduler.register({
        name: "bad",
        schedule: "invalid",
        enabled: true,
        handler: async () => {},
      }),
    ).toThrow();
  });

  it("executes task when cron matches current time", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);

    // Set time to a known moment
    vi.setSystemTime(new Date(2026, 2, 23, 3, 0, 0)); // Mon Mar 23, 2026 03:00

    const scheduler = new Scheduler();
    scheduler.register({
      name: "every-minute",
      schedule: "* * * * *", // matches every minute
      enabled: true,
      handler,
    });

    scheduler.start();

    // The tick runs immediately on start
    await vi.advanceTimersByTimeAsync(0);
    expect(handler).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it("does not double-fire within the same minute", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    vi.setSystemTime(new Date(2026, 2, 23, 3, 0, 0));

    const scheduler = new Scheduler();
    scheduler.register({
      name: "test",
      schedule: "* * * * *",
      enabled: true,
      handler,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(handler).toHaveBeenCalledTimes(1);

    // Advance 30 seconds (still same minute)
    await vi.advanceTimersByTimeAsync(30_000);
    expect(handler).toHaveBeenCalledTimes(1); // still 1

    scheduler.stop();
  });

  it("fires again in the next minute", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    vi.setSystemTime(new Date(2026, 2, 23, 3, 0, 0));

    const scheduler = new Scheduler();
    scheduler.register({
      name: "test",
      schedule: "* * * * *",
      enabled: true,
      handler,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(handler).toHaveBeenCalledTimes(1);

    // Advance to next minute
    vi.setSystemTime(new Date(2026, 2, 23, 3, 1, 0));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(handler).toHaveBeenCalledTimes(2);

    scheduler.stop();
  });

  it("does not execute when cron does not match", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    // Set to 4:00, but cron is 3:00
    vi.setSystemTime(new Date(2026, 2, 23, 4, 0, 0));

    const scheduler = new Scheduler();
    scheduler.register({
      name: "test",
      schedule: "0 3 * * *",
      enabled: true,
      handler,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(handler).toHaveBeenCalledTimes(0);

    scheduler.stop();
  });

  it("catches handler errors without crashing", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    vi.setSystemTime(new Date(2026, 2, 23, 3, 0, 0));

    const scheduler = new Scheduler();
    scheduler.register({
      name: "failing-task",
      schedule: "* * * * *",
      enabled: true,
      handler,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(handler).toHaveBeenCalledTimes(1);
    // No throw — error is caught internally

    scheduler.stop();
  });

  it("stop clears interval", () => {
    const scheduler = new Scheduler();
    scheduler.register({
      name: "test",
      schedule: "* * * * *",
      enabled: true,
      handler: async () => {},
    });
    scheduler.start();
    scheduler.stop();
    // Second stop is a no-op
    scheduler.stop();
  });
});
