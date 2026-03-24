import { describe, it, expect } from "vitest";
import { parseCron, matchesCron } from "./cron-parser.js";

describe("parseCron", () => {
  it("parses wildcard expression", () => {
    const fields = parseCron("* * * * *");
    expect(fields.minutes.size).toBe(60);
    expect(fields.hours.size).toBe(24);
    expect(fields.daysOfMonth.size).toBe(31);
    expect(fields.months.size).toBe(12);
    expect(fields.daysOfWeek.size).toBe(7);
  });

  it("parses specific values", () => {
    const fields = parseCron("0 3 * * *");
    expect(fields.minutes).toEqual(new Set([0]));
    expect(fields.hours).toEqual(new Set([3]));
  });

  it("parses step expressions", () => {
    const fields = parseCron("*/5 * * * *");
    expect(fields.minutes).toEqual(new Set([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]));
  });

  it("parses range expressions", () => {
    const fields = parseCron("0 9-17 * * *");
    expect(fields.hours).toEqual(new Set([9, 10, 11, 12, 13, 14, 15, 16, 17]));
  });

  it("parses list expressions", () => {
    const fields = parseCron("0 0 * * 1,3,5");
    expect(fields.daysOfWeek).toEqual(new Set([1, 3, 5]));
  });

  it("parses range with step", () => {
    const fields = parseCron("0 8-18/2 * * *");
    expect(fields.hours).toEqual(new Set([8, 10, 12, 14, 16, 18]));
  });

  it("throws on invalid expression", () => {
    expect(() => parseCron("bad")).toThrow("Invalid cron expression");
    expect(() => parseCron("* * *")).toThrow("Invalid cron expression");
  });

  it("parses every-10-minutes expression", () => {
    const fields = parseCron("*/10 * * * *");
    expect(fields.minutes).toEqual(new Set([0, 10, 20, 30, 40, 50]));
  });
});

describe("matchesCron", () => {
  it("matches wildcard on any date", () => {
    const fields = parseCron("* * * * *");
    expect(matchesCron(new Date(), fields)).toBe(true);
  });

  it("matches specific time", () => {
    const fields = parseCron("0 3 * * *");
    // 3:00 AM on any day
    const date = new Date(2026, 0, 15, 3, 0, 0); // Jan 15, 2026 03:00
    expect(matchesCron(date, fields)).toBe(true);
  });

  it("does not match wrong time", () => {
    const fields = parseCron("0 3 * * *");
    const date = new Date(2026, 0, 15, 4, 0, 0); // 04:00
    expect(matchesCron(date, fields)).toBe(false);
  });

  it("matches day of week", () => {
    const fields = parseCron("0 9 * * 1"); // Monday at 9:00
    // Find a Monday
    const monday = new Date(2026, 2, 23, 9, 0, 0); // Mar 23, 2026 is Monday
    expect(matchesCron(monday, fields)).toBe(true);
  });

  it("does not match wrong day of week", () => {
    const fields = parseCron("0 9 * * 1"); // Monday
    const tuesday = new Date(2026, 2, 24, 9, 0, 0); // Mar 24, 2026 is Tuesday
    expect(matchesCron(tuesday, fields)).toBe(false);
  });
});
