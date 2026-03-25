/**
 * Discord platform adapter.
 *
 * Uses discord.js for Gateway WebSocket connection.
 * Implements: PlatformAdapter, InlineButtonSender, TypingIndicator, MessageUpdater.
 */
import type {
  PlatformAdapter, PlatformSender, MessageHandler, MessageEvent,
  InlineButtonSender, TypingIndicator, MessageUpdater, ButtonOption,
} from "../types.js";

let Discord: any;

async function loadDiscord(): Promise<any> {
  if (!Discord) {
    try {
      const modName = "discord.js";
      Discord = await import(modName);
    } catch {
      throw new Error("discord.js is not installed. Run: npm install discord.js");
    }
  }
  return Discord;
}

function log(level: string, msg: string, meta?: Record<string, unknown>): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), level, msg, ...meta }));
}

export class DiscordAdapter implements PlatformAdapter, InlineButtonSender, TypingIndicator, MessageUpdater {
  readonly name = "discord";
  private client: any;
  private handler?: MessageHandler;
  private seenMessages = new Set<string>();

  constructor(
    private token: string,
    private opts?: { allowFrom?: string[] },
  ) {}

  async start(handler: MessageHandler): Promise<void> {
    await loadDiscord();
    this.handler = handler;

    const { Client, GatewayIntentBits, Partials } = Discord;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel, Partials.Message],
    });

    this.client.on("ready", () => {
      log("info", "Discord adapter connected", { user: this.client.user?.tag });
    });

    this.client.on("messageCreate", async (msg: any) => {
      try {
        await this.handleMessage(msg);
      } catch (err) {
        log("error", "Discord message handler error", { error: String(err) });
      }
    });

    this.client.on("interactionCreate", async (interaction: any) => {
      try {
        await this.handleInteraction(interaction);
      } catch (err) {
        log("error", "Discord interaction handler error", { error: String(err) });
      }
    });

    await this.client.login(this.token);
    log("info", "Discord adapter started");
  }

  async stop(): Promise<void> {
    if (this.client) {
      this.client.destroy();
    }
  }

  getSender(): PlatformSender {
    return {
      sendText: async (chatID, text) => {
        const channel = await this.client.channels.fetch(chatID);
        if (channel?.isTextBased()) {
          await this.splitAndSend(channel, text);
        }
      },
      sendMarkdown: async (chatID, markdown) => {
        const channel = await this.client.channels.fetch(chatID);
        if (channel?.isTextBased()) {
          const msg = await this.splitAndSend(channel, markdown);
          return msg ? String(msg.id) : undefined;
        }
      },
      sendInteractiveCard: async (chatID, cardJSON) => {
        const channel = await this.client.channels.fetch(chatID);
        if (channel?.isTextBased()) {
          await this.splitAndSend(channel, cardJSON);
        }
      },
      updateMarkdown: async (messageID, markdown) => {
        await this.updateMessage(messageID, markdown);
      },
      addReaction: async (messageID, emoji) => {
        // messageID format: "channelID:messageID"
        const [channelID, msgID] = messageID.split(":");
        if (!channelID || !msgID) return;
        try {
          const channel = await this.client.channels.fetch(channelID);
          if (channel?.isTextBased()) {
            const msg = await channel.messages.fetch(msgID);
            await msg.react(emoji);
          }
        } catch {
          // Ignore reaction errors
        }
      },
    };
  }

  // ─── InlineButtonSender ──────────────────────────────────────────────

  async sendWithButtons(chatID: string, content: string, buttons: ButtonOption[][]): Promise<void> {
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = Discord;
    const channel = await this.client.channels.fetch(chatID);
    if (!channel?.isTextBased()) return;

    const components = buttons.map((row) => {
      const actionRow = new ActionRowBuilder();
      row.forEach((btn, idx) => {
        const style = idx === 0 ? ButtonStyle.Success
          : idx === 1 ? ButtonStyle.Danger
          : ButtonStyle.Primary;
        actionRow.addComponents(
          new ButtonBuilder()
            .setCustomId(btn.value)
            .setLabel(btn.text)
            .setStyle(btn.type === "danger" ? ButtonStyle.Danger : btn.type === "primary" ? ButtonStyle.Primary : style),
        );
      });
      return actionRow;
    });

    await channel.send({ content, components });
  }

  // ─── TypingIndicator ─────────────────────────────────────────────────

  startTyping(chatID: string): { stop: () => void } {
    let running = true;
    const send = async () => {
      if (!running) return;
      try {
        const channel = await this.client.channels.fetch(chatID);
        if (channel?.isTextBased()) {
          await channel.sendTyping();
        }
      } catch { /* ignore */ }
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
    const [channelID, msgID] = messageID.split(":");
    if (!channelID || !msgID) return;
    try {
      const channel = await this.client.channels.fetch(channelID);
      if (channel?.isTextBased()) {
        const msg = await channel.messages.fetch(msgID);
        // Discord has a 2000-char limit
        const truncated = content.length > 2000 ? content.slice(0, 1997) + "..." : content;
        await msg.edit(truncated);
      }
    } catch {
      // Message may have been deleted
    }
  }

  // ─── Internal ────────────────────────────────────────────────────────

  private async handleMessage(msg: any): Promise<void> {
    if (!this.handler) return;
    if (msg.author.bot) return;

    // Dedup
    if (this.seenMessages.has(msg.id)) return;
    this.seenMessages.add(msg.id);
    if (this.seenMessages.size > 1000) {
      const first = this.seenMessages.values().next().value;
      if (first !== undefined) this.seenMessages.delete(first);
    }

    const userID = msg.author.id;
    const chatID = msg.channel.id;

    // ACL
    if (this.opts?.allowFrom?.length && !this.opts.allowFrom.includes(userID)) return;

    const chatType = msg.channel.isDMBased() ? "p2p" : "group";

    // In group chats, only respond to mentions
    let isMention = chatType === "p2p";
    if (chatType === "group") {
      if (msg.mentions.has(this.client.user)) {
        isMention = true;
      }
    }
    if (chatType === "group" && !isMention) return;

    // Strip bot mention
    let text = msg.content;
    text = text.replace(/<@!?\d+>/g, "").trim();

    if (!text) return;

    const event: MessageEvent = {
      platform: "discord",
      messageID: `${chatID}:${msg.id}`,
      chatID,
      chatType,
      userID,
      text,
      isMention,
      raw: msg,
    };

    await this.handler(event, this.getSender());
  }

  private async handleInteraction(interaction: any): Promise<void> {
    if (!this.handler) return;
    if (!interaction.isButton()) return;

    const data = interaction.customId;
    const userID = interaction.user.id;
    const chatID = interaction.channelId;

    // Acknowledge the interaction
    await interaction.deferUpdate().catch(() => {});

    // Edit the message to show chosen option
    const chosenLabel = interaction.component?.label ?? data;
    await interaction.editReply({
      content: `${interaction.message?.content ?? ""}\n\n> Chosen: **${chosenLabel}**`,
      components: [],
    }).catch(() => {});

    if (data.startsWith("cmd:")) {
      const event: MessageEvent = {
        platform: "discord",
        messageID: `cb-${Date.now()}`,
        chatID,
        chatType: "p2p",
        userID,
        text: data.slice(4),
        isMention: true,
        raw: interaction,
      };
      await this.handler(event, this.getSender());
    }
  }

  private async splitAndSend(channel: any, content: string): Promise<any> {
    // Discord has a 2000-char limit per message
    const chunks = splitMessage(content, 2000);
    let lastMsg: any;
    for (const chunk of chunks) {
      lastMsg = await channel.send(chunk);
    }
    return lastMsg;
  }
}

function splitMessage(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > limit) {
    // Try to split at a newline
    let splitIdx = remaining.lastIndexOf("\n", limit);
    if (splitIdx < limit / 2) splitIdx = limit;
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx);
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
