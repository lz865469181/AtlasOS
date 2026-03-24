export interface Attachment {
  type: "image" | "file";
  /** Local path after download. */
  path: string;
  /** Original filename. */
  name: string;
  mimeType?: string;
}

export interface MessageEvent {
  platform: string;
  messageID: string;
  chatID: string;
  chatType: "p2p" | "group";
  userID: string;
  text: string;
  isMention: boolean;
  /** Attached files/images downloaded to local workspace. */
  attachments?: Attachment[];
  raw?: unknown;
}

export interface PlatformSender {
  sendText(chatID: string, text: string, replyMessageID?: string): Promise<void>;
  sendMarkdown(chatID: string, markdown: string, replyMessageID?: string): Promise<string | void>;
  sendInteractiveCard(chatID: string, cardJSON: string, replyMessageID?: string): Promise<void>;
  /** Update an existing message with new markdown content (for streaming). */
  updateMarkdown(messageID: string, markdown: string): Promise<void>;
  addReaction(messageID: string, emoji: string): Promise<void>;
}

export type MessageHandler = (event: MessageEvent, sender: PlatformSender) => Promise<void>;

/** Card action callback data (e.g., button click from interactive card). */
export interface CardActionEvent {
  /** User who clicked the button. */
  userID: string;
  /** The chat where the card was sent. */
  chatID: string;
  /** The value attached to the button. */
  value: Record<string, unknown>;
}

export type CardActionHandler = (event: CardActionEvent, sender: PlatformSender) => Promise<void>;

export interface PlatformAdapter {
  readonly name: string;
  start(handler: MessageHandler): Promise<void>;
  stop(): Promise<void>;
  getSender(): PlatformSender;
}
