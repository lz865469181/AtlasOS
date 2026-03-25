/**
 * DingTalk platform adapter.
 *
 * Uses DingTalk Stream SDK for real-time message receiving.
 * Implements: PlatformAdapter.
 */
import type {
  PlatformAdapter, PlatformSender, MessageHandler, MessageEvent,
} from "../types.js";
import https from "node:https";

function log(level: string, msg: string, meta?: Record<string, unknown>): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), level, msg, ...meta }));
}

interface DingTalkMessage {
  msgtype: string;
  text?: { content: string };
  senderStaffId: string;
  conversationId: string;
  conversationType: string;
  sessionWebhook: string;
  msgId: string;
  senderNick?: string;
  isInAtList?: boolean;
}

export class DingTalkAdapter implements PlatformAdapter {
  readonly name = "dingtalk";
  private handler?: MessageHandler;
  private seenMessages = new Set<string>();
  private accessToken?: string;
  private tokenExpiry = 0;

  constructor(
    private appKey: string,
    private appSecret: string,
  ) {}

  async start(handler: MessageHandler): Promise<void> {
    this.handler = handler;
    // DingTalk Stream SDK requires the dingtalk-stream package
    // For now, we implement via webhook-compatible approach
    log("info", "DingTalk adapter started (webhook mode)");
    log("info", "Note: For production, install dingtalk-stream SDK for real-time messaging");
  }

  async stop(): Promise<void> {
    log("info", "DingTalk adapter stopped");
  }

  /**
   * Process an incoming DingTalk message (called by webhook handler).
   */
  async handleWebhookMessage(msg: DingTalkMessage): Promise<void> {
    if (!this.handler) return;
    if (msg.msgtype !== "text" || !msg.text?.content) return;

    // Dedup
    if (this.seenMessages.has(msg.msgId)) return;
    this.seenMessages.add(msg.msgId);
    if (this.seenMessages.size > 1000) {
      const first = this.seenMessages.values().next().value;
      if (first !== undefined) this.seenMessages.delete(first);
    }

    const chatType = msg.conversationType === "1" ? "p2p" : "group";
    const text = msg.text.content.trim();

    const event: MessageEvent = {
      platform: "dingtalk",
      messageID: msg.msgId,
      chatID: msg.conversationId,
      chatType,
      userID: msg.senderStaffId,
      text,
      isMention: msg.isInAtList ?? chatType === "p2p",
      raw: msg,
    };

    const sender = this.createSender(msg.sessionWebhook);
    await this.handler(event, sender);
  }

  getSender(): PlatformSender {
    return this.createSender("");
  }

  private createSender(sessionWebhook: string): PlatformSender {
    return {
      sendText: async (_chatID, text) => {
        await this.sendViaWebhook(sessionWebhook, {
          msgtype: "text",
          text: { content: text },
        });
      },
      sendMarkdown: async (_chatID, markdown) => {
        // DingTalk markdown has quirks - preprocess
        const processed = this.preprocessMarkdown(markdown);
        await this.sendViaWebhook(sessionWebhook, {
          msgtype: "markdown",
          markdown: { title: "Reply", text: processed },
        });
        return undefined;
      },
      sendInteractiveCard: async (_chatID, cardJSON) => {
        // DingTalk supports ActionCard for interactive content
        await this.sendViaWebhook(sessionWebhook, {
          msgtype: "markdown",
          markdown: { title: "Card", text: cardJSON },
        });
      },
      updateMarkdown: async () => {
        // DingTalk doesn't support message editing via session webhook
      },
      addReaction: async () => {
        // DingTalk doesn't support reactions
      },
    };
  }

  private async sendViaWebhook(webhookUrl: string, payload: any): Promise<void> {
    if (!webhookUrl) return;
    const body = JSON.stringify(payload);
    return new Promise((resolve, reject) => {
      const url = new URL(webhookUrl);
      const req = https.request({
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      }, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => resolve());
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }

  private preprocessMarkdown(md: string): string {
    // DingTalk markdown quirks:
    // - Leading spaces need non-breaking spaces
    // - Single newlines need trailing double-space for forced breaks
    return md
      .split("\n")
      .map((line) => {
        if (/^```/.test(line)) return line; // Don't touch code fences
        return line.replace(/^(\s+)/, (match) => "\u00A0".repeat(match.length));
      })
      .join("\n");
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const body = JSON.stringify({ appKey: this.appKey, appSecret: this.appSecret });
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: "api.dingtalk.com",
        path: "/v1.0/oauth2/accessToken",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      }, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try {
            const result = JSON.parse(data);
            this.accessToken = result.accessToken;
            this.tokenExpiry = Date.now() + (result.expireIn - 60) * 1000;
            resolve(this.accessToken!);
          } catch (err) {
            reject(err);
          }
        });
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }
}
