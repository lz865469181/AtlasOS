import * as lark from "@larksuiteoapi/node-sdk";
import type { PlatformAdapter, PlatformSender, MessageHandler, MessageEvent } from "../types.js";
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

  constructor(appId: string, appSecret: string) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.feishuClient = new FeishuClient(appId, appSecret);
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
          const createTimeMs = parseInt(data.message?.create_time, 10);
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

          const event = this.parseMessageEvent(data);
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

  private parseMessageEvent(data: FeishuMessageEvent): MessageEvent | null {
    const { message, sender } = data;

    const chatID = message.chat_id;
    const chatType = message.chat_type === "p2p" ? "p2p" as const : "group" as const;
    const messageID = message.message_id;
    const userID = sender.sender_id?.open_id ?? "unknown";

    // Only handle text messages for now
    if (message.message_type !== "text") {
      log("debug", "Skipping non-text message", { type: message.message_type });
      return null;
    }

    // Parse text content (content field is JSON string: {"text": "hello"})
    let text = "";
    try {
      const content = JSON.parse(message.content);
      text = content.text ?? "";
    } catch {
      text = message.content ?? "";
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

    if (!text.trim()) return null;

    return {
      platform: "feishu",
      messageID,
      chatID,
      chatType,
      userID,
      text: text.trim(),
      isMention,
      raw: data,
    };
  }
}
