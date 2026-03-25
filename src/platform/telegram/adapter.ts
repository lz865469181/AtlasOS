/**
 * Telegram platform adapter.
 *
 * Uses the Telegram Bot API via long-polling (node-telegram-bot-api).
 * Implements: PlatformAdapter, InlineButtonSender, TypingIndicator, MessageUpdater.
 */
import type {
  PlatformAdapter, PlatformSender, MessageHandler, MessageEvent,
  InlineButtonSender, TypingIndicator, MessageUpdater, ButtonOption,
} from "../types.js";

let TelegramBot: any;

async function loadTelegramBot(): Promise<any> {
  if (!TelegramBot) {
    try {
      const modName = "node-telegram-bot-api";
      TelegramBot = (await import(modName)).default;
    } catch {
      throw new Error("node-telegram-bot-api is not installed. Run: npm install node-telegram-bot-api");
    }
  }
  return TelegramBot;
}

function log(level: string, msg: string, meta?: Record<string, unknown>): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), level, msg, ...meta }));
}

export class TelegramAdapter implements PlatformAdapter, InlineButtonSender, TypingIndicator, MessageUpdater {
  readonly name = "telegram";
  private bot: any;
  private handler?: MessageHandler;
  private seenMessages = new Set<number>();
  private allowFrom: Set<string>;

  constructor(
    private token: string,
    opts?: { allowFrom?: string[] },
  ) {
    this.allowFrom = new Set(opts?.allowFrom ?? []);
  }

  async start(handler: MessageHandler): Promise<void> {
    await loadTelegramBot();
    this.handler = handler;
    this.bot = new TelegramBot(this.token, { polling: true });

    this.bot.on("message", async (msg: any) => {
      try {
        await this.handleMessage(msg);
      } catch (err) {
        log("error", "Telegram message handler error", { error: String(err) });
      }
    });

    this.bot.on("callback_query", async (query: any) => {
      try {
        await this.handleCallbackQuery(query);
      } catch (err) {
        log("error", "Telegram callback query error", { error: String(err) });
      }
    });

    log("info", "Telegram adapter started");
  }

  async stop(): Promise<void> {
    if (this.bot) {
      await this.bot.stopPolling();
    }
  }

  getSender(): PlatformSender {
    return {
      sendText: async (chatID, text, replyMessageID) => {
        await this.bot.sendMessage(chatID, text, {
          reply_to_message_id: replyMessageID ? Number(replyMessageID) : undefined,
        });
      },
      sendMarkdown: async (chatID, markdown, replyMessageID) => {
        try {
          const result = await this.bot.sendMessage(chatID, markdown, {
            parse_mode: "Markdown",
            reply_to_message_id: replyMessageID ? Number(replyMessageID) : undefined,
          });
          return String(result.message_id);
        } catch {
          // Fallback to plain text if markdown parsing fails
          const result = await this.bot.sendMessage(chatID, markdown, {
            reply_to_message_id: replyMessageID ? Number(replyMessageID) : undefined,
          });
          return String(result.message_id);
        }
      },
      sendInteractiveCard: async (chatID, cardJSON, replyMessageID) => {
        // Telegram doesn't support rich cards natively — send as text
        await this.bot.sendMessage(chatID, cardJSON, {
          reply_to_message_id: replyMessageID ? Number(replyMessageID) : undefined,
        });
      },
      updateMarkdown: async (messageID, markdown) => {
        await this.updateMessage(messageID, markdown);
      },
      addReaction: async () => {
        // Telegram Bot API reactions require premium or specific permissions
      },
    };
  }

  // ─── InlineButtonSender ──────────────────────────────────────────────

  async sendWithButtons(chatID: string, content: string, buttons: ButtonOption[][], replyMessageID?: string): Promise<void> {
    const inlineKeyboard = buttons.map((row) =>
      row.map((btn) => ({
        text: btn.text,
        callback_data: btn.value,
      })),
    );

    await this.bot.sendMessage(chatID, content, {
      parse_mode: "Markdown",
      reply_to_message_id: replyMessageID ? Number(replyMessageID) : undefined,
      reply_markup: { inline_keyboard: inlineKeyboard },
    });
  }

  // ─── TypingIndicator ─────────────────────────────────────────────────

  startTyping(chatID: string): { stop: () => void } {
    let running = true;
    const send = () => {
      if (running) {
        this.bot.sendChatAction(chatID, "typing").catch(() => {});
      }
    };
    send();
    const interval = setInterval(send, 5000);
    return {
      stop: () => {
        running = false;
        clearInterval(interval);
      },
    };
  }

  // ─── MessageUpdater ──────────────────────────────────────────────────

  async updateMessage(messageID: string, content: string): Promise<void> {
    // messageID format: "chatID:messageID"
    const [chatID, msgID] = messageID.split(":");
    if (!chatID || !msgID) return;
    try {
      await this.bot.editMessageText(content, {
        chat_id: chatID,
        message_id: Number(msgID),
        parse_mode: "Markdown",
      });
    } catch {
      // Fallback without markdown
      await this.bot.editMessageText(content, {
        chat_id: chatID,
        message_id: Number(msgID),
      }).catch(() => {});
    }
  }

  // ─── Internal ────────────────────────────────────────────────────────

  private async handleMessage(msg: any): Promise<void> {
    if (!this.handler) return;

    // Dedup
    if (this.seenMessages.has(msg.message_id)) return;
    this.seenMessages.add(msg.message_id);
    if (this.seenMessages.size > 1000) {
      const first = this.seenMessages.values().next().value;
      if (first !== undefined) this.seenMessages.delete(first);
    }

    // Skip old messages (>2 min)
    if (Date.now() / 1000 - msg.date > 120) return;

    const userID = String(msg.from?.id ?? "");
    const chatID = String(msg.chat.id);

    // ACL
    if (this.allowFrom.size > 0 && !this.allowFrom.has(userID)) return;

    const text = msg.text ?? msg.caption ?? "";
    if (!text) return;

    const chatType = msg.chat.type === "private" ? "p2p" : "group";

    // In group chats, only respond to mentions or replies to bot
    let isMention = chatType === "p2p";
    if (chatType === "group") {
      const botInfo = await this.bot.getMe();
      const botUsername = botInfo.username;
      if (text.includes(`@${botUsername}`) || msg.reply_to_message?.from?.id === botInfo.id) {
        isMention = true;
      }
    }

    if (chatType === "group" && !isMention) return;

    const cleanText = text.replace(/@\w+/g, "").trim();

    const event: MessageEvent = {
      platform: "telegram",
      messageID: String(msg.message_id),
      chatID,
      chatType,
      userID,
      text: cleanText,
      isMention,
      raw: msg,
    };

    await this.handler(event, this.getSender());
  }

  private async handleCallbackQuery(query: any): Promise<void> {
    if (!this.handler || !query.data) return;

    await this.bot.answerCallbackQuery(query.id);

    const chatID = String(query.message?.chat?.id ?? "");
    const userID = String(query.from?.id ?? "");
    const data = query.data as string;

    // Edit the message to show the chosen option
    if (query.message) {
      const originalText = query.message.text ?? "";
      const chosenLabel = this.findButtonLabel(query.message, data);
      await this.bot.editMessageText(
        `${originalText}\n\n> Chosen: **${chosenLabel}**`,
        {
          chat_id: chatID,
          message_id: query.message.message_id,
          parse_mode: "Markdown",
        },
      ).catch(() => {});
    }

    // Route callback data as a synthetic message
    if (data.startsWith("cmd:")) {
      const cmdText = data.slice(4);
      const event: MessageEvent = {
        platform: "telegram",
        messageID: `cb-${Date.now()}`,
        chatID,
        chatType: "p2p",
        userID,
        text: cmdText,
        isMention: true,
        raw: query,
      };
      await this.handler(event, this.getSender());
    } else if (data.startsWith("perm:")) {
      // Permission response - inject as text message
      const event: MessageEvent = {
        platform: "telegram",
        messageID: `perm-${Date.now()}`,
        chatID,
        chatType: "p2p",
        userID,
        text: data,
        isMention: true,
        raw: query,
      };
      await this.handler(event, this.getSender());
    }
  }

  private findButtonLabel(message: any, callbackData: string): string {
    const markup = message.reply_markup?.inline_keyboard ?? [];
    for (const row of markup) {
      for (const btn of row) {
        if (btn.callback_data === callbackData) return btn.text;
      }
    }
    return callbackData;
  }
}
