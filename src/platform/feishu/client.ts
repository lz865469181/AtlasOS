import * as lark from "@larksuiteoapi/node-sdk";
import type { PlatformSender } from "../types.js";

function log(level: string, msg: string, meta?: Record<string, unknown>): void {
  const entry = { time: new Date().toISOString(), level, msg, ...meta };
  console.log(JSON.stringify(entry));
}

export class FeishuClient implements PlatformSender {
  private client: lark.Client;

  constructor(appId: string, appSecret: string) {
    this.client = new lark.Client({ appId, appSecret });
  }

  getLarkClient(): lark.Client {
    return this.client;
  }

  async sendText(
    chatID: string,
    text: string,
    replyMessageID?: string,
  ): Promise<void> {
    const content = JSON.stringify({ text });

    try {
      if (replyMessageID) {
        // Reply to the original message
        await this.client.im.message.reply({
          path: { message_id: replyMessageID },
          data: { content, msg_type: "text" },
        });
      } else {
        // Send new message to chat
        await this.client.im.message.create({
          params: { receive_id_type: "chat_id" },
          data: { receive_id: chatID, msg_type: "text", content },
        });
      }
    } catch (err) {
      log("error", "Failed to send text message", { chatID, error: String(err) });
      throw err;
    }
  }

  async sendMarkdown(
    chatID: string,
    markdown: string,
    replyMessageID?: string,
  ): Promise<string | void> {
    // Feishu uses interactive cards for markdown content
    const card = {
      config: { wide_screen_mode: true },
      elements: [
        { tag: "markdown" as const, content: markdown },
      ],
    };
    const content = JSON.stringify(card);

    try {
      if (replyMessageID) {
        const resp = await this.client.im.message.reply({
          path: { message_id: replyMessageID },
          data: { content, msg_type: "interactive" },
        });
        return (resp as any)?.data?.message_id ?? undefined;
      } else {
        const resp = await this.client.im.message.create({
          params: { receive_id_type: "chat_id" },
          data: { receive_id: chatID, msg_type: "interactive", content },
        });
        return (resp as any)?.data?.message_id ?? undefined;
      }
    } catch (err) {
      log("error", "Failed to send markdown card", { chatID, error: String(err) });
      throw err;
    }
  }

  async sendInteractiveCard(
    chatID: string,
    cardJSON: string,
    replyMessageID?: string,
  ): Promise<void> {
    try {
      if (replyMessageID) {
        await this.client.im.message.reply({
          path: { message_id: replyMessageID },
          data: { content: cardJSON, msg_type: "interactive" },
        });
      } else {
        await this.client.im.message.create({
          params: { receive_id_type: "chat_id" },
          data: { receive_id: chatID, msg_type: "interactive", content: cardJSON },
        });
      }
    } catch (err) {
      log("error", "Failed to send interactive card", { chatID, error: String(err) });
      throw err;
    }
  }

  async updateMarkdown(messageID: string, markdown: string): Promise<void> {
    const card = {
      config: { wide_screen_mode: true },
      elements: [
        { tag: "markdown" as const, content: markdown },
      ],
    };
    const content = JSON.stringify(card);

    try {
      await this.client.im.message.patch({
        path: { message_id: messageID },
        data: { content },
      });
    } catch (err) {
      log("warn", "Failed to update markdown card", { messageID, error: String(err) });
    }
  }

  async addReaction(messageID: string, emoji: string): Promise<void> {
    try {
      await this.client.im.messageReaction.create({
        path: { message_id: messageID },
        data: { reaction_type: { emoji_type: emoji } },
      });
    } catch (err) {
      log("warn", "Failed to add reaction", { messageID, emoji, error: String(err) });
    }
  }
}
