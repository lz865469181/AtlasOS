import * as lark from "@larksuiteoapi/node-sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { PlatformAdapter, PlatformSender, MessageHandler, MessageEvent, Attachment, CardActionHandler } from "../types.js";
import { FeishuClient } from "./client.js";

function log(level: string, msg: string, meta?: Record<string, unknown>): void {
  const entry = { time: new Date().toISOString(), level, msg, ...meta };
  console.log(JSON.stringify(entry));
}

/** Event data shape from im.message.receive_v1 (matches SDK types). */
interface FeishuMessageEvent {
  sender: {
    sender_id?: { open_id?: string; user_id?: string; union_id?: string };
    sender_type: string;
    tenant_key?: string;
  };
  message: {
    message_id: string;
    root_id?: string;
    parent_id?: string;
    create_time: string;
    chat_id: string;
    chat_type: string;
    message_type: string;
    content: string;
    mentions?: Array<{
      key: string;
      id: { open_id?: string; user_id?: string; union_id?: string };
      name: string;
      tenant_key?: string;
    }>;
  };
}

export class FeishuAdapter implements PlatformAdapter {
  readonly name = "feishu";
  private feishuClient: FeishuClient;
  private wsClient: lark.WSClient | null = null;
  private appId: string;
  private appSecret: string;
  /** Dedup: track recently processed message IDs to avoid duplicate replies. */
  private processedMessages = new Set<string>();
  private readonly DEDUP_MAX = 1000;
  /** Max age for incoming messages — discard if older than this (ms). */
  private readonly MAX_AGE_MS = 2 * 60 * 1000; // 2 minutes
  /** Optional card action handler for interactive card button clicks. */
  private cardActionHandler: CardActionHandler | null = null;
  /** Root directory for file downloads. */
  private uploadsRoot: string | null = null;

  constructor(appId: string, appSecret: string, uploadsRoot?: string) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.feishuClient = new FeishuClient(appId, appSecret);
    this.uploadsRoot = uploadsRoot ?? null;
  }

  /** Register a handler for interactive card button clicks (used by HTTP callback route). */
  onCardAction(handler: CardActionHandler): void {
    this.cardActionHandler = handler;
  }

  /** Get the registered card action handler (for use by external HTTP routes). */
  getCardActionHandler(): CardActionHandler | null {
    return this.cardActionHandler;
  }

  getSender(): PlatformSender {
    return this.feishuClient;
  }

  async start(handler: MessageHandler): Promise<void> {
    const eventDispatcher = new lark.EventDispatcher({}).register({
      "im.message.receive_v1": async (data: FeishuMessageEvent) => {
        try {
          const msgId = data.message?.message_id;

          // Dedup: skip already-processed messages
          if (msgId && this.processedMessages.has(msgId)) {
            log("debug", "Skipping duplicate message", { messageID: msgId });
            return;
          }

          // Timestamp check: discard messages older than 2 minutes
          const createTimeMs = Number(data.message?.create_time);
          if (createTimeMs) {
            const ageMs = Date.now() - createTimeMs;
            if (ageMs > this.MAX_AGE_MS) {
              log("info", "Skipping stale message", {
                messageID: msgId,
                ageSeconds: Math.round(ageMs / 1000),
              });
              return;
            }
          }

          const event = await this.parseMessageEvent(data);
          if (!event) return;

          // Mark as processed
          if (msgId) {
            this.processedMessages.add(msgId);
            // Evict oldest entries to prevent unbounded growth
            if (this.processedMessages.size > this.DEDUP_MAX) {
              const first = this.processedMessages.values().next().value;
              if (first) this.processedMessages.delete(first);
            }
          }

          await handler(event, this.feishuClient);
        } catch (err) {
          log("error", "Error handling Feishu message", { error: String(err) });
        }
      },
    });

    this.wsClient = new lark.WSClient({
      appId: this.appId,
      appSecret: this.appSecret,
      loggerLevel: lark.LoggerLevel.warn,
    });

    log("info", "Starting Feishu WebSocket connection");
    await this.wsClient.start({ eventDispatcher });
    log("info", "Feishu adapter started");
  }

  async stop(): Promise<void> {
    log("info", "Feishu adapter stopping");
    if (this.wsClient) {
      this.wsClient.close();
    }
  }

  private async parseMessageEvent(data: FeishuMessageEvent): Promise<MessageEvent | null> {
    const { message, sender } = data;

    const chatID = message.chat_id;
    const chatType = message.chat_type === "p2p" ? "p2p" as const : "group" as const;
    const messageID = message.message_id;
    const userID = sender.sender_id?.open_id ?? "unknown";

    let text = "";
    const attachments: Attachment[] = [];

    if (message.message_type === "text") {
      // Parse text content (content field is JSON string: {"text": "hello"})
      try {
        const content = JSON.parse(message.content);
        text = content.text ?? "";
      } catch {
        text = message.content ?? "";
      }
    } else if (message.message_type === "image") {
      // Image message: download and attach
      try {
        const content = JSON.parse(message.content);
        const imageKey = content.image_key;
        if (imageKey && this.uploadsRoot) {
          const attachment = await this.downloadImage(imageKey, userID, messageID);
          if (attachment) attachments.push(attachment);
          text = "(see attached image)";
        }
      } catch (err) {
        log("warn", "Failed to process image message", { error: String(err) });
        return null;
      }
    } else if (message.message_type === "file") {
      // File message: download and attach
      try {
        const content = JSON.parse(message.content);
        const fileKey = content.file_key;
        const fileName = content.file_name ?? "file";
        if (fileKey && this.uploadsRoot) {
          const attachment = await this.downloadFile(fileKey, fileName, userID, messageID);
          if (attachment) attachments.push(attachment);
          text = `(see attached file: ${fileName})`;
        }
      } catch (err) {
        log("warn", "Failed to process file message", { error: String(err) });
        return null;
      }
    } else {
      log("debug", "Skipping unsupported message type", { type: message.message_type });
      return null;
    }

    // Check for @mention (in group chats)
    const mentions = message.mentions ?? [];
    const isMention = mentions.length > 0;

    // Strip @mention placeholders from text (e.g., @_user_1 → removed)
    if (isMention) {
      for (const mention of mentions) {
        if (mention.key) {
          text = text.replace(mention.key, "").trim();
        }
      }
    }

    if (!text.trim() && attachments.length === 0) return null;

    return {
      platform: "feishu",
      messageID,
      chatID,
      chatType,
      userID,
      text: text.trim(),
      isMention,
      attachments: attachments.length > 0 ? attachments : undefined,
      raw: data,
    };
  }

  /**
   * Download an image from Feishu and save to uploads directory.
   * Returns an Attachment descriptor, or null on failure.
   */
  private async downloadImage(imageKey: string, userID: string, messageID: string): Promise<Attachment | null> {
    if (!this.uploadsRoot) return null;
    try {
      const sanitizedUser = userID.replace(/[\\/]/g, "_").replace(/\.\./g, "_");
      const userUploads = join(this.uploadsRoot, sanitizedUser);
      // Verify resolved path stays within uploads root
      if (!resolve(userUploads).startsWith(resolve(this.uploadsRoot))) return null;
      mkdirSync(userUploads, { recursive: true });
      const filename = `${messageID}_${imageKey}.png`;
      const filepath = join(userUploads, filename);

      const resp: any = await this.feishuClient.getLarkClient().im.messageResource.get({
        path: { message_id: messageID, file_key: imageKey },
        params: { type: "image" },
      });
      if (resp && Buffer.isBuffer(resp)) {
        writeFileSync(filepath, resp);
        log("info", "Image downloaded", { imageKey, path: filepath });
      }

      return { type: "image", path: filepath, name: filename, mimeType: "image/png" };
    } catch (err) {
      log("warn", "Failed to download image", { imageKey, error: String(err) });
      return null;
    }
  }

  /**
   * Download a file from Feishu and save to uploads directory.
   */
  private async downloadFile(fileKey: string, fileName: string, userID: string, messageID: string): Promise<Attachment | null> {
    if (!this.uploadsRoot) return null;
    try {
      const sanitizedUser = userID.replace(/[\\/]/g, "_").replace(/\.\./g, "_");
      const userUploads = join(this.uploadsRoot, sanitizedUser);
      // Verify resolved path stays within uploads root
      if (!resolve(userUploads).startsWith(resolve(this.uploadsRoot))) return null;
      mkdirSync(userUploads, { recursive: true });
      const safeName = `${messageID}_${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const filepath = join(userUploads, safeName);

      const resp: any = await this.feishuClient.getLarkClient().im.messageResource.get({
        path: { message_id: messageID, file_key: fileKey },
        params: { type: "file" },
      });
      if (resp && Buffer.isBuffer(resp)) {
        writeFileSync(filepath, resp);
        log("info", "File downloaded", { fileKey, path: filepath });
      }

      return { type: "file", path: filepath, name: fileName };
    } catch (err) {
      log("warn", "Failed to download file", { fileKey, error: String(err) });
      return null;
    }
  }
}
