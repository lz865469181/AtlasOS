import type { CommandDef, CommandContext } from "./registry.js";
import type { ParkedSessionStore } from "../session/parked.js";

function timeAgo(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function createSessionsCommand(store: ParkedSessionStore): CommandDef {
  return {
    name: "sessions",
    description: "List parked CLI sessions available for resume",
    aliases: ["ss"],
    handler: async (ctx: CommandContext) => {
      const sessions = store.list();
      if (sessions.length === 0) {
        await ctx.reply("No parked sessions. Use `beam-flow park` from your terminal to park a session.");
        return;
      }
      const lines = sessions.map((s, i) => {
        const ago = timeAgo(Date.now() - s.parkedAt);
        return `${i + 1}. **${s.name}** (${ago})`;
      });
      const text = `**Parked Sessions**\n\n${lines.join("\n")}\n\nTo resume: \`/resume <name>\``;
      await ctx.reply(text);
    },
  };
}

export type ResumeFn = (cliSessionId: string, ctx: { userID: string; chatID: string; chatType: string; platform: string }) => Promise<void>;

export function createResumeCommand(store: ParkedSessionStore, resumeFn: ResumeFn): CommandDef {
  return {
    name: "resume",
    description: "Resume a parked CLI session",
    aliases: ["rs"],
    handler: async (ctx: CommandContext) => {
      const name = ctx.args.trim();
      if (!name) {
        await ctx.reply("Usage: `/resume <session-name>`");
        return;
      }
      const parked = store.get(name);
      if (!parked) {
        await ctx.reply(`Session '${name}' not found. Use \`/sessions\` to list available sessions.`);
        return;
      }
      try {
        await resumeFn(parked.cliSessionId, {
          userID: ctx.userID,
          chatID: ctx.chatID,
          chatType: ctx.chatType,
          platform: ctx.platform,
        });
        store.remove(name);
        store.saveToDisk();
        await ctx.reply(`Resumed session '${name}'! Claude remembers your conversation. Send a message to continue.`);
      } catch (err) {
        await ctx.reply(`Failed to resume '${name}': ${err}`);
      }
    },
  };
}
