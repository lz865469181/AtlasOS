export enum ErrorType {
  TIMEOUT = "timeout",
  RATE_LIMIT = "rate_limit",
  CONTEXT_OVERFLOW = "context_overflow",
  MODEL_ERROR = "model_error",
  CLI_NOT_FOUND = "cli_not_found",
  AUTH_ERROR = "auth_error",
  UNKNOWN = "unknown",
}

export interface ClassifiedError {
  type: ErrorType;
  message: string;
  retryable: boolean;
  /** Human-friendly message for the user. */
  userMessage: string;
}

/**
 * Classify an error from the Claude CLI into a specific type
 * with user-friendly message and retry guidance.
 */
export function classifyError(err: Error): ClassifiedError {
  const msg = err.message || String(err);
  const lower = msg.toLowerCase();

  // Context overflow (already handled separately, but included for completeness)
  if ((err as any).contextOverflow || /context.*(window|limit|overflow)|too (many|long)|token.*limit/i.test(msg)) {
    return {
      type: ErrorType.CONTEXT_OVERFLOW,
      message: msg,
      retryable: true,
      userMessage: "The conversation got too long. I've reset the context and will try again.",
    };
  }

  // CLI not found
  if (lower.includes("enoent") || (lower.includes("spawn") && lower.includes("not found"))) {
    return {
      type: ErrorType.CLI_NOT_FOUND,
      message: msg,
      retryable: false,
      userMessage: "Claude CLI is not installed or not in PATH. Please contact the administrator.",
    };
  }

  // Authentication errors
  if (/401|403|unauthorized|forbidden|api.?key|auth.*fail|invalid.*key/i.test(msg)) {
    return {
      type: ErrorType.AUTH_ERROR,
      message: msg,
      retryable: false,
      userMessage: "Authentication failed. The API key may be invalid or expired.",
    };
  }

  // Rate limiting
  if (/429|rate.?limit|too many requests|quota|throttl/i.test(msg)) {
    return {
      type: ErrorType.RATE_LIMIT,
      message: msg,
      retryable: true,
      userMessage: "Rate limited by the API. Please wait a moment and try again.",
    };
  }

  // Timeout
  if ((err as any).killed || /timeout|timed?\s*out|sigterm|sigkill/i.test(msg)) {
    return {
      type: ErrorType.TIMEOUT,
      message: msg,
      retryable: true,
      userMessage: "The request timed out. Try a shorter or simpler prompt.",
    };
  }

  // Model/server errors
  if (/500|502|503|504|server.?error|model.*error|overloaded|service.?unavailable/i.test(msg)) {
    return {
      type: ErrorType.MODEL_ERROR,
      message: msg,
      retryable: true,
      userMessage: "The AI model is temporarily unavailable. Please try again shortly.",
    };
  }

  return {
    type: ErrorType.UNKNOWN,
    message: msg,
    retryable: false,
    userMessage: "Sorry, I encountered an error processing your message. Please try again.",
  };
}
