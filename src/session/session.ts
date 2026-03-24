export interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

import type { BackendType } from "../config.js";

/** Default model for all sessions. Empty = let CLI use its own default. */
export const DEFAULT_MODEL = "";

/** Available models per backend. */
export const BACKEND_MODELS: Record<BackendType, Record<string, string>> = {
  claude: {
    "claude-haiku-4-5-20251001": "Haiku (Fast, Default)",
    "claude-sonnet-4-6": "Sonnet (Balanced)",
    "claude-opus-4-6": "Opus (Most Capable)",
  },
  opencode: {
    "anthropic/claude-haiku-4-5-20251001": "Haiku (Fast, Default)",
    "anthropic/claude-sonnet-4-6": "Sonnet (Balanced)",
    "anthropic/claude-opus-4-6": "Opus (Most Capable)",
    "openai/gpt-4o": "GPT-4o (OpenAI)",
    "google/gemini-2.5-pro": "Gemini 2.5 Pro (Google)",
  },
};

/** Default export for backwards compat — returns Claude models. */
export const AVAILABLE_MODELS = BACKEND_MODELS.claude;

/** Default models per backend. */
export const DEFAULT_MODELS: Record<BackendType, string> = {
  claude: "claude-haiku-4-5-20251001",
  opencode: "anthropic/claude-haiku-4-5-20251001",
};

export class Session {
  readonly id: string;
  agentID: string;
  readonly userID: string;
  readonly conversation: Message[] = [];
  readonly createdAt: number;
  lastActiveAt: number;
  /** The model to use for Claude CLI calls in this session. */
  model: string = DEFAULT_MODEL;
  /** Stable CLI session ID for --session-id (persists across calls). */
  cliSessionId: string;
  /** Override cwd for CLI invocations (set when resuming an external local session). */
  cliWorkDir?: string;
  /** Number of times context overflow was detected and session was reset. */
  contextOverflowCount = 0;

  constructor(id: string, agentID: string, userID: string) {
    this.id = id;
    this.agentID = agentID;
    this.userID = userID;
    this.createdAt = Date.now();
    this.lastActiveAt = Date.now();
    this.cliSessionId = crypto.randomUUID();
  }

  /** Reset the CLI session ID (used after context overflow). */
  resetCliSession(): void {
    this.cliSessionId = crypto.randomUUID();
    this.cliWorkDir = undefined;
    this.contextOverflowCount++;
  }

  /** Attach to an existing local CLI session from a specific project directory. */
  attachExternalSession(sessionId: string, workDir: string): void {
    this.cliSessionId = sessionId;
    this.cliWorkDir = workDir;
  }

  /** Detach from external session, returning to normal bot session. */
  detachExternalSession(): void {
    this.cliSessionId = crypto.randomUUID();
    this.cliWorkDir = undefined;
  }

  /** Maximum number of messages to keep in conversation history. */
  private static readonly MAX_CONVERSATION_SIZE = 200;

  addMessage(role: "user" | "assistant", content: string): void {
    this.conversation.push({ role, content, timestamp: Date.now() });
    this.lastActiveAt = Date.now();
    // Trim oldest messages to prevent unbounded memory growth
    if (this.conversation.length > Session.MAX_CONVERSATION_SIZE) {
      this.conversation.splice(0, this.conversation.length - Session.MAX_CONVERSATION_SIZE);
    }
  }

  /** Build conversation history as text for context injection. */
  getConversationText(maxMessages = 50): string {
    const recent = this.conversation.slice(-maxMessages);
    if (recent.length === 0) return "";
    return recent
      .map((m) => `[${m.role}]: ${m.content}`)
      .join("\n\n");
  }

  touch(): void {
    this.lastActiveAt = Date.now();
  }

  /** Serialize session to a plain object for JSON persistence. */
  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      agentID: this.agentID,
      userID: this.userID,
      model: this.model,
      cliSessionId: this.cliSessionId,
      cliWorkDir: this.cliWorkDir,
      contextOverflowCount: this.contextOverflowCount,
      conversation: this.conversation,
      createdAt: this.createdAt,
      lastActiveAt: this.lastActiveAt,
    };
  }

  /** Restore a session from a persisted JSON object. */
  static fromJSON(data: Record<string, any>): Session {
    const session = new Session(data.id, data.agentID, data.userID);
    session.model = data.model ?? DEFAULT_MODEL;
    session.cliSessionId = data.cliSessionId ?? crypto.randomUUID();
    session.cliWorkDir = data.cliWorkDir ?? undefined;
    session.contextOverflowCount = data.contextOverflowCount ?? 0;
    Object.defineProperty(session, "createdAt", { value: data.createdAt ?? Date.now() });
    session.lastActiveAt = data.lastActiveAt ?? Date.now();

    if (Array.isArray(data.conversation)) {
      for (const msg of data.conversation) {
        if (msg.role && msg.content) {
          session.conversation.push({
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp ?? Date.now(),
          });
        }
      }
    }

    return session;
  }
}
