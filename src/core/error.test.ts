import { describe, it, expect } from "vitest";
import { classifyError, ErrorType } from "./error.js";

describe("classifyError", () => {
  it("detects context overflow", () => {
    const result = classifyError(new Error("context window limit exceeded"));
    expect(result.type).toBe(ErrorType.CONTEXT_OVERFLOW);
    expect(result.retryable).toBe(true);
  });

  it("detects context overflow from token limit", () => {
    const result = classifyError(new Error("token limit reached"));
    expect(result.type).toBe(ErrorType.CONTEXT_OVERFLOW);
  });

  it("detects CLI not found (ENOENT)", () => {
    const result = classifyError(new Error("spawn claude ENOENT"));
    expect(result.type).toBe(ErrorType.CLI_NOT_FOUND);
    expect(result.retryable).toBe(false);
  });

  it("detects auth errors", () => {
    const result = classifyError(new Error("401 Unauthorized"));
    expect(result.type).toBe(ErrorType.AUTH_ERROR);
    expect(result.retryable).toBe(false);
  });

  it("detects auth errors from invalid key", () => {
    const result = classifyError(new Error("invalid api key"));
    expect(result.type).toBe(ErrorType.AUTH_ERROR);
  });

  it("detects rate limiting", () => {
    const result = classifyError(new Error("rate limit exceeded, please slow down"));
    expect(result.type).toBe(ErrorType.RATE_LIMIT);
    expect(result.retryable).toBe(true);
  });

  it("detects timeout", () => {
    const result = classifyError(new Error("request timed out"));
    expect(result.type).toBe(ErrorType.TIMEOUT);
    expect(result.retryable).toBe(true);
  });

  it("detects timeout from killed process", () => {
    const err = new Error("Process terminated") as any;
    err.killed = true;
    const result = classifyError(err);
    expect(result.type).toBe(ErrorType.TIMEOUT);
  });

  it("detects model/server errors", () => {
    const result = classifyError(new Error("502 Bad Gateway"));
    expect(result.type).toBe(ErrorType.MODEL_ERROR);
    expect(result.retryable).toBe(true);
  });

  it("classifies unknown errors", () => {
    const result = classifyError(new Error("something unexpected"));
    expect(result.type).toBe(ErrorType.UNKNOWN);
    expect(result.retryable).toBe(false);
  });

  it("always returns a userMessage", () => {
    for (const msg of [
      "context overflow", "ENOENT", "401", "429", "timeout", "502", "unknown",
    ]) {
      const result = classifyError(new Error(msg));
      expect(result.userMessage).toBeTruthy();
    }
  });
});
