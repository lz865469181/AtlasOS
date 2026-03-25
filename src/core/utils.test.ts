import { describe, it, expect } from "vitest";
import { estimateTokens, createLineIterator } from "./utils.js";
import { Readable } from "node:stream";

describe("estimateTokens", () => {
  it("estimates tokens from text length", () => {
    // 35 chars / 3.5 = 10 tokens
    expect(estimateTokens("a".repeat(35))).toBe(10);
  });

  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("rounds up", () => {
    // 1 char / 3.5 = ~0.28, ceil = 1
    expect(estimateTokens("a")).toBe(1);
  });
});

describe("createLineIterator", () => {
  function makeStream(chunks: string[]): NodeJS.ReadableStream {
    return Readable.from(chunks);
  }

  it("yields complete lines from single chunk", async () => {
    const stream = makeStream(["line1\nline2\nline3\n"]);
    const lines: string[] = [];
    for await (const line of createLineIterator(stream)) {
      lines.push(line);
    }
    expect(lines).toEqual(["line1", "line2", "line3"]);
  });

  it("handles lines split across chunks", async () => {
    const stream = makeStream(["hel", "lo\nwor", "ld\n"]);
    const lines: string[] = [];
    for await (const line of createLineIterator(stream)) {
      lines.push(line);
    }
    expect(lines).toEqual(["hello", "world"]);
  });

  it("yields trailing content without newline", async () => {
    const stream = makeStream(["line1\npartial"]);
    const lines: string[] = [];
    for await (const line of createLineIterator(stream)) {
      lines.push(line);
    }
    expect(lines).toEqual(["line1", "partial"]);
  });

  it("skips empty lines", async () => {
    const stream = makeStream(["a\n\n\nb\n"]);
    const lines: string[] = [];
    for await (const line of createLineIterator(stream)) {
      lines.push(line);
    }
    expect(lines).toEqual(["a", "b"]);
  });

  it("handles empty stream", async () => {
    const stream = makeStream([]);
    const lines: string[] = [];
    for await (const line of createLineIterator(stream)) {
      lines.push(line);
    }
    expect(lines).toEqual([]);
  });
});
