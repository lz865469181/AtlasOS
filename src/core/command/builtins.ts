import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CommandDef, CommandContext } from "./registry.js";
import type { ParkedSessionStore } from "../session/parked.js";
import type { Engine } from "../engine.js";
import { normalizeWorkspacePath } from "../session/normalize.js";

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

function looksLikeGitUrl(url: string): boolean {
  return /^(https?:\/\/|git@)[\w./-]+$/.test(url);
}

export function createWorkspaceCommand(engine: Engine): CommandDef {
  return {
    name: "workspace",
    description: "Manage workspace bindings",
    aliases: ["ws"],
    handler: async (ctx: CommandContext) => {
      if (!engine.isMultiWorkspace) {
        await ctx.reply(
          "Multi-workspace mode is not enabled. Set `mode: \"multi-workspace\"` and `base_dir` in config.",
        );
        return;
      }

      const [sub, ...rest] = ctx.args.trim().split(/\s+/);
      const channelKey = `${ctx.platform}:${ctx.chatID}`;

      switch (sub || "") {
        case "": {
          const binding = engine.bindings!.get(channelKey);
          if (binding) {
            await ctx.reply(
              `Workspace: ${binding.workspace}\nBound at: ${binding.boundAt}`,
            );
          } else {
            await ctx.reply(
              "No workspace bound to this channel.\nUse `/workspace bind <name>` or `/workspace init <git-url>`.",
            );
          }
          break;
        }

        case "bind": {
          const name = rest[0];
          if (!name) {
            await ctx.reply("Usage: `/workspace bind <folder-name>`");
            return;
          }

          const baseDir = engine.workspaceBaseDir!;
          const workspace = join(baseDir, name);
          const normalized = normalizeWorkspacePath(workspace);

          if (!existsSync(normalized)) {
            await ctx.reply(
              `Directory not found: ${normalized}\nUse \`/workspace init <git-url>\` to clone a repo.`,
            );
            return;
          }

          engine.bindings!.set(channelKey, {
            channelName: ctx.chatID,
            workspace: normalized,
            boundAt: new Date().toISOString(),
          });
          await ctx.reply(`Workspace bound: ${normalized}`);
          break;
        }

        case "init": {
          const url = rest[0];
          if (!url) {
            await ctx.reply("Usage: `/workspace init <git-url>`");
            return;
          }

          if (!looksLikeGitUrl(url)) {
            await ctx.reply("Invalid URL. Provide an HTTPS or SSH git URL.");
            return;
          }

          const repoName =
            url.split("/").pop()?.replace(/\.git$/, "") ?? "repo";
          const baseDir = engine.workspaceBaseDir!;
          const workspace = join(baseDir, repoName);

          if (existsSync(workspace)) {
            const normalized = normalizeWorkspacePath(workspace);
            engine.bindings!.set(channelKey, {
              channelName: ctx.chatID,
              workspace: normalized,
              boundAt: new Date().toISOString(),
            });
            await ctx.reply(
              `Directory already exists. Bound workspace: ${normalized}`,
            );
            return;
          }

          await ctx.reply(`Cloning ${url} to ${workspace}...`);

          try {
            const { execSync } = await import("node:child_process");
            execSync(`git clone ${url} "${workspace}"`, { timeout: 120_000 });

            const normalized = normalizeWorkspacePath(workspace);
            engine.bindings!.set(channelKey, {
              channelName: ctx.chatID,
              workspace: normalized,
              boundAt: new Date().toISOString(),
            });
            await ctx.reply(`Clone complete. Bound workspace: ${normalized}`);
          } catch (err: any) {
            await ctx.reply(`Clone failed: ${err.message}`);
          }
          break;
        }

        case "unbind": {
          const removed = engine.bindings!.remove(channelKey);
          await ctx.reply(
            removed
              ? "Workspace unbound."
              : "No workspace was bound to this channel.",
          );
          break;
        }

        case "list": {
          const all = engine.bindings!.list();
          if (all.length === 0) {
            await ctx.reply("No workspace bindings.");
            return;
          }
          const lines = all.map(
            (b) => `\u2022 ${b.channelKey} \u2192 ${b.workspace}`,
          );
          await ctx.reply(`Workspace bindings:\n${lines.join("\n")}`);
          break;
        }

        default:
          await ctx.reply(
            `Unknown subcommand: ${sub}\nUsage: /workspace [bind|init|unbind|list]`,
          );
      }
    },
  };
}
