export interface Attachment {
  type: "image" | "file" | "audio";
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

// ─── Optional Capability Interfaces ──────────────────────────────────────────
// Platforms opt-in by implementing these. The engine detects via type checks.

export interface InlineButtonSender {
  sendWithButtons(chatID: string, content: string, buttons: ButtonOption[][], replyMessageID?: string): Promise<void>;
}

export interface ImageSender {
  sendImage(chatID: string, image: ImageAttachment, replyMessageID?: string): Promise<void>;
}

export interface FileSender {
  sendFile(chatID: string, file: FileAttachment, replyMessageID?: string): Promise<void>;
}

export interface AudioSender {
  sendAudio(chatID: string, audio: Buffer, format: string, replyMessageID?: string): Promise<void>;
}

export interface TypingIndicator {
  startTyping(chatID: string): { stop: () => void };
}

export interface MessageUpdater {
  updateMessage(messageID: string, content: string): Promise<void>;
}

export interface ButtonOption {
  text: string;
  value: string;
  type?: "primary" | "default" | "danger";
}

export interface ImageAttachment {
  data?: Buffer;
  url?: string;
  filename: string;
  mimeType?: string;
}

export interface FileAttachment {
  data?: Buffer;
  url?: string;
  filename: string;
  mimeType?: string;
}

// ─── Card Model ──────────────────────────────────────────────────────────────

export type CardHeaderColor = "blue" | "green" | "orange" | "red" | "purple" | "grey";

export interface CardHeader {
  title: string;
  color?: CardHeaderColor;
}

export type CardElement =
  | { type: "markdown"; content: string }
  | { type: "divider" }
  | { type: "actions"; buttons: CardButton[]; layout?: "row" | "equal_columns" }
  | { type: "note"; content: string }
  | { type: "list_item"; text: string; button?: CardButton };

export interface CardButton {
  text: string;
  type: "primary" | "default" | "danger";
  value: string;
  extra?: Record<string, string>;
}

export interface Card {
  header?: CardHeader;
  elements: CardElement[];
}

// ─── Card Builder ────────────────────────────────────────────────────────────

export class CardBuilder {
  private _header?: CardHeader;
  private _elements: CardElement[] = [];

  title(text: string, color?: CardHeaderColor): this {
    this._header = { title: text, color };
    return this;
  }

  markdown(content: string): this {
    this._elements.push({ type: "markdown", content });
    return this;
  }

  divider(): this {
    this._elements.push({ type: "divider" });
    return this;
  }

  buttons(buttons: CardButton[], layout?: "row" | "equal_columns"): this {
    this._elements.push({ type: "actions", buttons, layout });
    return this;
  }

  note(content: string): this {
    this._elements.push({ type: "note", content });
    return this;
  }

  listItem(text: string, button?: CardButton): this {
    this._elements.push({ type: "list_item", text, button });
    return this;
  }

  build(): Card {
    return { header: this._header, elements: this._elements };
  }
}

/** Render a Card as plain text (fallback for platforms without card support). */
export function renderCardAsText(card: Card): string {
  const lines: string[] = [];
  if (card.header) {
    lines.push(`**${card.header.title}**`);
    lines.push("");
  }
  for (const el of card.elements) {
    switch (el.type) {
      case "markdown":
        lines.push(el.content);
        break;
      case "divider":
        lines.push("---");
        break;
      case "actions":
        lines.push(el.buttons.map((b) => `[${b.text}]`).join("  "));
        break;
      case "note":
        lines.push(`_${el.content}_`);
        break;
      case "list_item":
        lines.push(`${el.text}${el.button ? `  [${el.button.text}]` : ""}`);
        break;
    }
  }
  return lines.join("\n");
}

/** Extract all buttons from a Card as rows of ButtonOption (for InlineButtonSender fallback). */
export function collectCardButtons(card: Card): ButtonOption[][] {
  const rows: ButtonOption[][] = [];
  for (const el of card.elements) {
    if (el.type === "actions") {
      rows.push(
        el.buttons.map((b) => ({ text: b.text, value: b.value, type: b.type })),
      );
    } else if (el.type === "list_item" && el.button) {
      rows.push([{ text: el.button.text, value: el.button.value, type: el.button.type }]);
    }
  }
  return rows;
}

// ─── Capability detection helpers ────────────────────────────────────────────

export function supportsInlineButtons(adapter: PlatformAdapter): adapter is PlatformAdapter & InlineButtonSender {
  return "sendWithButtons" in adapter && typeof (adapter as any).sendWithButtons === "function";
}

export function supportsImages(adapter: PlatformAdapter): adapter is PlatformAdapter & ImageSender {
  return "sendImage" in adapter && typeof (adapter as any).sendImage === "function";
}

export function supportsFiles(adapter: PlatformAdapter): adapter is PlatformAdapter & FileSender {
  return "sendFile" in adapter && typeof (adapter as any).sendFile === "function";
}

export function supportsAudio(adapter: PlatformAdapter): adapter is PlatformAdapter & AudioSender {
  return "sendAudio" in adapter && typeof (adapter as any).sendAudio === "function";
}

export function supportsTyping(adapter: PlatformAdapter): adapter is PlatformAdapter & TypingIndicator {
  return "startTyping" in adapter && typeof (adapter as any).startTyping === "function";
}
