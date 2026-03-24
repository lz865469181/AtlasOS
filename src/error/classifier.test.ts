import { describe, it, expect } from "vitest";
import { classifyError, ErrorType } from "./classifier.js";

describe("classifyError", () => {
  it("classifies context overflow errors", () => {
    const result = classifyError(new Error("context window exceeded"));
    expect(result.type).toBe(ErrorType.CONTEXT_OVERFLOW);
    expect(result.retryable).toBe(true);
  });

  it("classifies context overflow via token limit", () => {
    const result = classifyError(new Error("token limit reached for this model"));
    expect(result.type).toBe(ErrorType.CONTEXT_OVERFLOW);
  });

  it("classifies context overflow via contextOverflow flag", () => {
    const err = new Error("something") as any;
    err.contextOverflow = true;
    const result = classifyError(err);
    expect(result.type).toBe(ErrorType.CONTEXT_OVERFLOW);
    expect(result.retryable).toBe(true);
  });

  it("classifies CLI not found (ENOENT)", () => {
    const result = classifyError(new Error("ENOENT: no such file or directory"));
    expect(result.type).toBe(ErrorType.CLI_NOT_FOUND);
    expect(result.retryable).toBe(false);
    expect(result.userMessage).toContain("not installed");
  });

  it("classifies auth errors (401)", () => {
    const result = classifyError(new Error("API returned 401 Unauthorized"));
    expect(result.type).toBe(ErrorType.AUTH_ERROR);
    expect(result.retryable).toBe(false);
  });

  it("classifies auth errors (invalid key)", () => {
    const result = classifyError(new Error("invalid api key provided"));
    expect(result.type).toBe(ErrorType.AUTH_ERROR);
  });

  it("classifies auth errors (403 forbidden)", () => {
    const result = classifyError(new Error("403 Forbidden"));
    expect(result.type).toBe(ErrorType.AUTH_ERROR);
  });

  it("classifies rate limit errors (429)", () => {
    const result = classifyError(new Error("HTTP 429: rate limit exceeded"));
    expect(result.type).toBe(ErrorType.RATE_LIMIT);
    expect(result.retryable).toBe(true);
  });

  it("classifies rate limit errors (text)", () => {
    const result = classifyError(new Error("rate limit exceeded, please slow down"));
    expect(result.type).toBe(ErrorType.RATE_LIMIT);
  });

  it("classifies quota errors as rate limit", () => {
    const result = classifyError(new Error("quota exceeded for this organization"));
    expect(result.type).toBe(ErrorType.RATE_LIMIT);
  });

  it("classifies timeout errors (text)", () => {
    const result = classifyError(new Error("request timed out after 120s"));
    expect(result.type).toBe(ErrorType.TIMEOUT);
    expect(result.retryable).toBe(true);
  });

  it("classifies timeout errors (killed flag)", () => {
    const err = new Error("process terminated") as any;
    err.killed = true;
    const result = classifyError(err);
    expect(result.type).toBe(ErrorType.TIMEOUT);
  });

  it("classifies timeout errors (SIGTERM)", () => {
    const result = classifyError(new Error("SIGTERM received"));
    expect(result.type).toBe(ErrorType.TIMEOUT);
  });

  it("classifies model/server errors (500)", () => {
    const result = classifyError(new Error("500 Internal Server Error"));
    expect(result.type).toBe(ErrorType.MODEL_ERROR);
    expect(result.retryable).toBe(true);
  });

  it("classifies model/server errors (overloaded)", () => {
    const result = classifyError(new Error("model is overloaded, try again later"));
    expect(result.type).toBe(ErrorType.MODEL_ERROR);
  });

  it("classifies model/server errors (503)", () => {
    const result = classifyError(new Error("503 Service Unavailable"));
    expect(result.type).toBe(ErrorType.MODEL_ERROR);
  });

  it("returns UNKNOWN for unrecognized errors", () => {
    const result = classifyError(new Error("something completely unexpected"));
    expect(result.type).toBe(ErrorType.UNKNOWN);
    expect(result.retryable).toBe(false);
    expect(result.userMessage).toContain("error");
  });

  it("always includes userMessage", () => {
    const types = [
      new Error("context overflow"),
      new Error("ENOENT"),
      new Error("401 Unauthorized"),
      new Error("429 rate limit"),
      new Error("timeout"),
      new Error("500 server error"),
      new Error("random error"),
    ];
    for (const err of types) {
      const result = classifyError(err);
      expect(result.userMessage).toBeTruthy();
      expect(result.userMessage.length).toBeGreaterThan(10);
    }
  });
});
