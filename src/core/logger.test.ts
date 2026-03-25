import { describe, it, expect, vi } from "vitest";
import { log, redactToken } from "./logger.js";

describe("log", () => {
  it("outputs structured JSON to console", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log("info", "test message", { key: "value" });
    expect(spy).toHaveBeenCalledOnce();
    const output = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(output.level).toBe("info");
    expect(output.msg).toBe("test message");
    expect(output.key).toBe("value");
    expect(output.time).toBeDefined();
    spy.mockRestore();
  });

  it("works without metadata", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log("warn", "no meta");
    const output = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(output.msg).toBe("no meta");
    spy.mockRestore();
  });
});

describe("redactToken", () => {
  it("shows first 4 and last 4 chars for long tokens", () => {
    expect(redactToken("sk-ant-12345678abcdef")).toBe("sk-a...cdef");
  });

  it("returns *** for short tokens", () => {
    expect(redactToken("abc")).toBe("***");
    expect(redactToken("12345678")).toBe("***");
  });

  it("handles tokens exactly at boundary", () => {
    expect(redactToken("123456789")).toBe("1234...6789");
  });
});
