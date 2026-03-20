export interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export class Session {
  readonly id: string;
  readonly agentID: string;
  readonly userID: string;
  readonly conversation: Message[] = [];
  readonly createdAt: number;
  lastActiveAt: number;

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
