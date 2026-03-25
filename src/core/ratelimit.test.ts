import { describe, it, expect, afterEach } from "vitest";
import { RateLimiter, UserRoleManager } from "./ratelimit.js";

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  afterEach(() => {
    limiter?.dispose();
  });

  it("allows messages within limit", () => {
    limiter = new RateLimiter({ maxMessages: 3, windowMs: 60_000 });
    expect(limiter.allow("user1")).toBe(true);
    expect(limiter.allow("user1")).toBe(true);
    expect(limiter.allow("user1")).toBe(true);
  });

  it("blocks messages exceeding limit", () => {
    limiter = new RateLimiter({ maxMessages: 2, windowMs: 60_000 });
    expect(limiter.allow("user1")).toBe(true);
    expect(limiter.allow("user1")).toBe(true);
    expect(limiter.allow("user1")).toBe(false);
  });

  it("tracks users independently", () => {
    limiter = new RateLimiter({ maxMessages: 1, windowMs: 60_000 });
    expect(limiter.allow("user1")).toBe(true);
    expect(limiter.allow("user2")).toBe(true);
    expect(limiter.allow("user1")).toBe(false);
  });

  it("allows everything when maxMessages is 0", () => {
    limiter = new RateLimiter({ maxMessages: 0, windowMs: 60_000 });
    for (let i = 0; i < 100; i++) {
      expect(limiter.allow("user1")).toBe(true);
    }
  });

  it("reports remaining count", () => {
    limiter = new RateLimiter({ maxMessages: 3, windowMs: 60_000 });
    expect(limiter.remaining("user1")).toBe(3);
    limiter.allow("user1");
    expect(limiter.remaining("user1")).toBe(2);
    limiter.allow("user1");
    limiter.allow("user1");
    expect(limiter.remaining("user1")).toBe(0);
  });

  it("remaining returns Infinity when maxMessages is 0", () => {
    limiter = new RateLimiter({ maxMessages: 0, windowMs: 60_000 });
    expect(limiter.remaining("user1")).toBe(Infinity);
  });
});

describe("UserRoleManager", () => {
  let manager: UserRoleManager;

  afterEach(() => {
    manager?.dispose();
  });

  it("resolves role by user ID (case insensitive)", () => {
    manager = new UserRoleManager();
    manager.configure([
      { name: "admin", userIDs: ["Alice", "Bob"] },
    ]);
    expect(manager.resolveRole("alice")?.name).toBe("admin");
    expect(manager.resolveRole("ALICE")?.name).toBe("admin");
  });

  it("resolves wildcard role", () => {
    manager = new UserRoleManager();
    manager.configure([
      { name: "everyone", userIDs: ["*"] },
    ]);
    expect(manager.resolveRole("anyone")?.name).toBe("everyone");
  });

  it("resolves default role when no direct match", () => {
    manager = new UserRoleManager();
    manager.configure([
      { name: "admin", userIDs: ["alice"] },
      { name: "user", userIDs: [] },
    ], "user");
    expect(manager.resolveRole("bob")?.name).toBe("user");
  });

  it("returns undefined when no match and no default", () => {
    manager = new UserRoleManager();
    manager.configure([
      { name: "admin", userIDs: ["alice"] },
    ]);
    expect(manager.resolveRole("bob")).toBeUndefined();
  });

  it("checks disabled commands", () => {
    manager = new UserRoleManager();
    manager.configure([
      { name: "limited", userIDs: ["user1"], disabledCommands: ["restart", "model"] },
    ]);
    expect(manager.isCommandDisabled("user1", "/restart")).toBe(true);
    expect(manager.isCommandDisabled("user1", "model")).toBe(true);
    expect(manager.isCommandDisabled("user1", "help")).toBe(false);
  });

  it("wildcard * disables all commands", () => {
    manager = new UserRoleManager();
    manager.configure([
      { name: "readonly", userIDs: ["user1"], disabledCommands: ["*"] },
    ]);
    expect(manager.isCommandDisabled("user1", "anything")).toBe(true);
  });

  it("enforces per-role rate limits", () => {
    manager = new UserRoleManager();
    manager.configure([
      { name: "limited", userIDs: ["user1"], rateLimit: { maxMessages: 1, windowMs: 60_000 } },
    ]);
    const first = manager.allowRate("user1");
    expect(first).toEqual({ allowed: true, handled: true });
    const second = manager.allowRate("user1");
    expect(second).toEqual({ allowed: false, handled: true });
  });

  it("returns handled=false when no rate limit configured", () => {
    manager = new UserRoleManager();
    manager.configure([
      { name: "free", userIDs: ["user1"] },
    ]);
    expect(manager.allowRate("user1")).toEqual({ allowed: true, handled: false });
  });
});
