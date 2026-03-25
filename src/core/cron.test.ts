import { describe, it, expect } from "vitest";
import { parseCron, matchesCron, cronToHuman } from "./cron.js";

describe("parseCron", () => {
  it("parses simple every-minute expression", () => {
    const fields = parseCron("* * * * *");
    expect(fields.minutes.size).toBe(60);
    expect(fields.hours.size).toBe(24);
    expect(fields.daysOfMonth.size).toBe(31);
    expect(fields.months.size).toBe(12);
    expect(fields.daysOfWeek.size).toBe(7);
  });

  it("parses specific minute/hour", () => {
    const fields = parseCron("30 9 * * *");
    expect(fields.minutes).toEqual(new Set([30]));
    expect(fields.hours).toEqual(new Set([9]));
  });

  it("parses step expressions", () => {
    const fields = parseCron("*/15 * * * *");
    expect(fields.minutes).toEqual(new Set([0, 15, 30, 45]));
  });

  it("parses range expressions", () => {
    const fields = parseCron("0 9-17 * * *");
    expect(fields.hours).toEqual(new Set([9, 10, 11, 12, 13, 14, 15, 16, 17]));
  });

  it("parses comma-separated values", () => {
    const fields = parseCron("0 9,12,18 * * *");
    expect(fields.hours).toEqual(new Set([9, 12, 18]));
  });

  it("parses weekday range", () => {
    const fields = parseCron("0 9 * * 1-5");
    expect(fields.daysOfWeek).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  it("parses range with step", () => {
    const fields = parseCron("0-30/10 * * * *");
    expect(fields.minutes).toEqual(new Set([0, 10, 20, 30]));
  });

  it("throws on invalid expression (wrong field count)", () => {
    expect(() => parseCron("* * *")).toThrow("expected 5 fields");
  });
});

describe("matchesCron", () => {
  it("matches every-minute expression against any date", () => {
    const fields = parseCron("* * * * *");
    expect(matchesCron(new Date(), fields)).toBe(true);
  });

  it("matches specific minute/hour", () => {
    const fields = parseCron("30 9 * * *");
    const match = new Date(2025, 0, 15, 9, 30); // Jan 15 2025 09:30
    const noMatch = new Date(2025, 0, 15, 9, 31);
    expect(matchesCron(match, fields)).toBe(true);
    expect(matchesCron(noMatch, fields)).toBe(false);
  });

  it("matches weekday-only schedule", () => {
    const fields = parseCron("0 9 * * 1"); // Monday only
    const monday = new Date(2025, 0, 6, 9, 0); // Jan 6 2025 is Monday
    const tuesday = new Date(2025, 0, 7, 9, 0);
    expect(matchesCron(monday, fields)).toBe(true);
    expect(matchesCron(tuesday, fields)).toBe(false);
  });

  it("matches specific month", () => {
    const fields = parseCron("0 0 1 6 *"); // June 1st midnight
    const june = new Date(2025, 5, 1, 0, 0); // month is 0-indexed
    const july = new Date(2025, 6, 1, 0, 0);
    expect(matchesCron(june, fields)).toBe(true);
    expect(matchesCron(july, fields)).toBe(false);
  });
});

describe("cronToHuman", () => {
  it("describes step minutes", () => {
    expect(cronToHuman("*/5 * * * *")).toBe("Every 5 minutes");
  });

  it("describes daily schedule", () => {
    expect(cronToHuman("30 9 * * *")).toBe("Daily at 9:30");
  });

  it("describes hourly schedule", () => {
    expect(cronToHuman("0 * * * *")).toBe("Every hour at :00");
  });

  it("describes weekday schedule", () => {
    expect(cronToHuman("0 9 * * 1-5")).toBe("At 9:00 on days 1-5");
  });

  it("returns raw expression for complex patterns", () => {
    expect(cronToHuman("0 */2 1,15 * *")).toBe("0 */2 1,15 * *");
  });

  it("returns raw expression for invalid input", () => {
    expect(cronToHuman("not valid")).toBe("not valid");
  });
});
