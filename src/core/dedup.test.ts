import { describe, it, expect, afterEach } from "vitest";
import { MessageDedup, isOldMessage } from "./dedup.js";

describe("MessageDedup", () => {
  let dedup: MessageDedup;

  afterEach(() => {
    dedup?.dispose();
  });

  it("returns false for first occurrence", () => {
    dedup = new MessageDedup();
    expect(dedup.isDuplicate("msg-1")).toBe(false);
  });

  it("returns true for second occurrence", () => {
    dedup = new MessageDedup();
    dedup.isDuplicate("msg-1");
    expect(dedup.isDuplicate("msg-1")).toBe(true);
  });

  it("tracks multiple distinct IDs independently", () => {
    dedup = new MessageDedup();
    expect(dedup.isDuplicate("a")).toBe(false);
    expect(dedup.isDuplicate("b")).toBe(false);
    expect(dedup.isDuplicate("a")).toBe(true);
    expect(dedup.isDuplicate("b")).toBe(true);
    expect(dedup.isDuplicate("c")).toBe(false);
  });

  it("dispose clears the interval without error", () => {
    dedup = new MessageDedup();
    dedup.dispose();
    // Should not throw if called twice
    dedup.dispose();
  });
});

describe("isOldMessage", () => {
  it("returns true for timestamps well before process start", () => {
    // A timestamp from 1 hour ago should be old
    expect(isOldMessage(Date.now() - 3_600_000)).toBe(true);
  });

  it("returns false for recent timestamps", () => {
    // A timestamp from right now should not be old
    expect(isOldMessage(Date.now())).toBe(false);
  });

  it("respects custom grace period", () => {
    // With a very large grace, even old timestamps are not old
    expect(isOldMessage(Date.now() - 5000, 10_000)).toBe(false);
  });
});
