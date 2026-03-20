export interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

import type { BackendType } from "../config.js";

/** Default model for all sessions. */
export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

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
  readonly agentID: string;
  readonly userID: string;
  readonly conversation: Message[] = [];
  readonly createdAt: number;
  lastActiveAt: number;
  /** The model to use for Claude CLI calls in this session. */
  model: string = DEFAULT_MODEL;

  constructor(id: string, agentID: string, userID: string) {
    this.id = id;
    this.agentID = agentID;
    this.userID = userID;
    this.createdAt = Date.now();
    this.lastActiveAt = Date.now();
  }

  addMessage(role: "user" | "assistant", content: string): void {
    this.conversation.push({ role, content, timestamp: Date.now() });
    this.lastActiveAt = Date.now();
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
}
