import type { Session } from "../session/session.js";
import { ask } from "../backend/index.js";

function log(level: string, msg: string, meta?: Record<string, unknown>): void {
  const entry = { time: new Date().toISOString(), level, msg, ...meta };
  console.log(JSON.stringify(entry));
}

export interface ContextManagerConfig {
  /** Max estimated tokens before triggering summarization. Default: 150000. */
  maxTokens: number;
  /** Number of recent messages to preserve (never summarized). Default: 10. */
  preserveRecent: number;
  /** Model to use for summarization. Empty = let CLI decide. */
  summaryModel: string;
}

const DEFAULT_CONFIG: ContextManagerConfig = {
  maxTokens: 150_000,
  preserveRecent: 10,
  summaryModel: "",
};

export class ContextManager {
  private config: ContextManagerConfig;

  constructor(config?: Partial<ContextManagerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Rough token estimate: ~4 chars per token for English, ~2 for CJK.
   * Good enough for threshold detection without external dependencies.
   */
  estimateTokens(session: Session): number {
    let totalChars = 0;
    for (const msg of session.conversation) {
      totalChars += msg.content.length;
    }
    return Math.ceil(totalChars / 3.5);
  }

  /**
   * If conversation exceeds token threshold, summarize older messages.
   * Replaces them with a single summary message in the session.
   */
  async maybeSummarize(session: Session): Promise<void> {
    const tokens = this.estimateTokens(session);
    if (tokens < this.config.maxTokens) return;

    const { preserveRecent } = this.config;
    const msgs = session.conversation;

    if (msgs.length <= preserveRecent + 1) return; // nothing to summarize

    const toSummarize = msgs.slice(0, msgs.length - preserveRecent);
    const toKeep = msgs.slice(msgs.length - preserveRecent);

    log("info", "Summarizing conversation context", {
      sessionId: session.id,
      totalMessages: msgs.length,
      summarizing: toSummarize.length,
      keeping: toKeep.length,
      estimatedTokens: tokens,
    });

    try {
      const conversationText = toSummarize
        .map((m) => `[${m.role}]: ${m.content.slice(0, 2000)}`)
        .join("\n\n");

      const result = await ask({
        prompt: `Summarize the following conversation history. Preserve all key decisions, facts, technical details, user preferences, and action items. Be concise but thorough.\n\n${conversationText}`,
        model: this.config.summaryModel || undefined,
        maxRetries: 1,
      });

      const summaryText = result.result || "(summary unavailable)";

      // Replace conversation: summary + recent messages
      session.conversation.length = 0;
      session.conversation.push({
        role: "assistant",
        content: `[Context Summary]\n${summaryText}`,
        timestamp: Date.now(),
      });
      session.conversation.push(...toKeep);

      log("info", "Context summarized", {
        sessionId: session.id,
        newMessageCount: session.conversation.length,
        summaryLen: summaryText.length,
      });
    } catch (err) {
      // Summarization failure is non-fatal — skip and let context overflow handle it
      log("warn", "Context summarization failed, skipping", {
        sessionId: session.id,
        error: String(err),
      });
    }
  }
}
