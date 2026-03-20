export interface MessageEvent {
  platform: string;
  messageID: string;
  chatID: string;
  chatType: "p2p" | "group";
  userID: string;
  text: string;
  isMention: boolean;
  raw?: unknown;
}

export interface PlatformSender {
  sendText(chatID: string, text: string, replyMessageID?: string): Promise<void>;
  sendMarkdown(chatID: string, markdown: string, replyMessageID?: string): Promise<void>;
  addReaction(messageID: string, emoji: string): Promise<void>;
}

export type MessageHandler = (event: MessageEvent, sender: PlatformSender) => Promise<void>;

export interface PlatformAdapter {
  readonly name: string;
  start(handler: MessageHandler): Promise<void>;
  stop(): Promise<void>;
  getSender(): PlatformSender;
}
