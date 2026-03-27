import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CommandDef, CommandContext } from "./registry.js";
import type { ParkedSessionStore } from "../session/parked.js";
import type { Engine } from "../engine.js";
import type { Agent } from "../../agent/types.js";
import { supportsModelSwitching } from "../../agent/types.js";
import { normalizeWorkspacePath } from "../session/normalize.js";
import { projectRoot } from "../../config.js";

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
    description: "List CLI sessions (running and parked)",
    aliases: ["ss"],
    handler: async (ctx: CommandContext) => {
      const sessions = store.list();
      if (sessions.length === 0) {
        await ctx.reply("No sessions. Use `beam-flow start <name>` from your terminal to start a session.");
        return;
      }
      const lines = sessions.map((s, i) => {
        const icon = s.status === "running" ? "🟢" : "🅿️";
        const label = s.status === "running" ? "Running" : "Parked";
        const refTime = s.status === "running" ? s.startedAt : s.parkedAt;
        const ago = timeAgo(Date.now() - refTime);
        return `${i + 1}. ${icon} **${s.name}** — ${label} (${ago})`;
      });
      const text = `**Sessions**\n\n${lines.join("\n")}\n\nTo resume a parked session: \`/resume <name>\``;
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
      const wasRunning = parked.status === "running";
      try {
        await resumeFn(parked.cliSessionId, {
          userID: ctx.userID,
          chatID: ctx.chatID,
          chatType: ctx.chatType,
          platform: ctx.platform,
        });
        store.remove(name);
        store.saveToDisk();
        const msg = wasRunning
          ? `Took over session '${name}' from local CLI. Send a message to continue.`
          : `Resumed session '${name}'! Claude remembers your conversation. Send a message to continue.`;
        await ctx.reply(msg);
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

// ─── /new, /reset ────────────────────────────────────────────────────────────

export function createNewCommand(engine: Engine): CommandDef {
  return {
    name: "new",
    description: "Create a new session (clear current context)",
    aliases: ["reset"],
    handler: async (ctx: CommandContext) => {
      const key = engine.buildSessionKey(ctx.userID);
      await engine.resetSession(key);
      await ctx.reply("Session reset. Send a message to start a new conversation.");
    },
  };
}

// ─── /model ──────────────────────────────────────────────────────────────────

export function createModelCommand(engine: Engine): CommandDef {
  return {
    name: "model",
    description: "Switch AI model or list available models",
    aliases: ["m"],
    handler: async (ctx: CommandContext) => {
      const agent = engine.agent;
      if (!supportsModelSwitching(agent)) {
        await ctx.reply("Model switching is not supported by the current backend.");
        return;
      }

      const models = await agent.availableModels();
      const current = agent.currentModel();

      if (!ctx.args.trim()) {
        // List available models
        const lines = Object.entries(models).map(([id, label]) => {
          const marker = id === current ? " (current)" : "";
          return `- \`${id}\` — ${label}${marker}`;
        });
        await ctx.reply(`**Current model:** \`${current || "default"}\`\n\n**Available models:**\n${lines.join("\n")}\n\nUsage: \`/model <model-id>\``);
        return;
      }

      const target = ctx.args.trim();
      // Allow partial match
      const match = Object.keys(models).find(
        (id) => id === target || id.includes(target),
      );

      if (!match) {
        await ctx.reply(`Unknown model: \`${target}\`\nAvailable: ${Object.keys(models).join(", ")}`);
        return;
      }

      agent.setModel(match);
      // Reset session so new model takes effect
      const key = engine.buildSessionKey(ctx.userID);
      await engine.resetSession(key);
      await ctx.reply(`Model switched to \`${match}\` (${models[match]}). Session reset to apply new model.`);
    },
  };
}

// ─── /help ───────────────────────────────────────────────────────────────────

export function createHelpCommand(engine: Engine): CommandDef {
  return {
    name: "help",
    description: "List all available commands",
    aliases: ["h"],
    handler: async (ctx: CommandContext) => {
      const all = engine.commands.listAll();
      const lines = all.map((cmd) => {
        const aliases = "aliases" in cmd && cmd.aliases?.length
          ? ` (${cmd.aliases.map((a) => `/${a}`).join(", ")})`
          : "";
        return `- \`/${cmd.name}\`${aliases} — ${cmd.description}`;
      });
      await ctx.reply(`**Available Commands**\n\n${lines.join("\n")}`);
    },
  };
}

// ─── /status ─────────────────────────────────────────────────────────────────

export function createStatusCommand(engine: Engine): CommandDef {
  return {
    name: "status",
    description: "Show current session and server status",
    handler: async (ctx: CommandContext) => {
      const key = engine.buildSessionKey(ctx.userID);
      const state = engine.getState(key);
      const meta = engine.sessionMgr.get(key);
      const uptimeMs = Date.now() - engine.startedAt;
      const uptimeH = Math.floor(uptimeMs / 3_600_000);
      const uptimeM = Math.floor((uptimeMs % 3_600_000) / 60_000);

      const lines = [
        `**Server Status**`,
        `- Backend: \`${engine.agentName}\``,
        `- Platforms: ${engine.platformNames.join(", ")}`,
        `- Uptime: ${uptimeH}h ${uptimeM}m`,
        `- Active sessions: ${engine.sessionMgr.size}`,
        ``,
        `**Your Session**`,
        `- Key: \`${key}\``,
        `- State: ${state ? "active" : "idle"}`,
        `- Model: \`${meta?.model || "default"}\``,
        `- Last active: ${meta ? timeAgo(Date.now() - meta.lastActiveAt) : "never"}`,
      ];
      if (meta?.cliSessionId) {
        lines.push(`- CLI Session: \`${meta.cliSessionId.slice(0, 8)}...\``);
      }
      await ctx.reply(lines.join("\n"));
    },
  };
}

// ─── /stop ───────────────────────────────────────────────────────────────────

export function createStopCommand(engine: Engine): CommandDef {
  return {
    name: "stop",
    description: "Stop the current agent execution",
    handler: async (ctx: CommandContext) => {
      const key = engine.buildSessionKey(ctx.userID);
      const state = engine.getState(key);
      if (!state) {
        await ctx.reply("No active session to stop.");
        return;
      }
      await engine.resetSession(key);
      await ctx.reply("Execution stopped. Send a new message to continue.");
    },
  };
}

// ─── /list (alias for /sessions) ─────────────────────────────────────────────

export function createListCommand(store: ParkedSessionStore): CommandDef {
  return {
    name: "list",
    description: "List CLI sessions (alias for /sessions)",
    aliases: ["ls"],
    handler: async (ctx: CommandContext) => {
      const sessions = store.list();
      if (sessions.length === 0) {
        await ctx.reply("No sessions. Use `beam-flow start <name>` from your terminal to start a session.");
        return;
      }
      const lines = sessions.map((s, i) => {
        const icon = s.status === "running" ? "🟢" : "🅿️";
        const label = s.status === "running" ? "Running" : "Parked";
        const refTime = s.status === "running" ? s.startedAt : s.parkedAt;
        const ago = timeAgo(Date.now() - refTime);
        return `${i + 1}. ${icon} **${s.name}** — ${label} (${ago})`;
      });
      await ctx.reply(`**Sessions**\n\n${lines.join("\n")}\n\nTo resume a parked session: \`/resume <name>\``);
    },
  };
}

// ─── /switch ─────────────────────────────────────────────────────────────────

export function createSwitchCommand(engine: Engine): CommandDef {
  return {
    name: "switch",
    description: "Switch to a parked session by name",
    aliases: ["sw"],
    handler: async (ctx: CommandContext) => {
      const name = ctx.args.trim();
      if (!name) {
        await ctx.reply("Usage: `/switch <session-name>`\nUse `/sessions` to list available sessions.");
        return;
      }
      const parked = engine.parkedSessions.get(name);
      if (!parked) {
        await ctx.reply(`Session '${name}' not found. Use \`/sessions\` to list available sessions.`);
        return;
      }
      // Reset current session first
      const key = engine.buildSessionKey(ctx.userID);
      await engine.resetSession(key);
      // Store the CLI session ID so next message resumes it
      const meta = engine.sessionMgr.get(key);
      if (meta) {
        meta.cliSessionId = parked.cliSessionId;
      }
      engine.parkedSessions.remove(name);
      engine.parkedSessions.saveToDisk();
      await ctx.reply(`Switched to session '${name}'. Send a message to continue the conversation.`);
    },
  };
}

// ─── /delete ─────────────────────────────────────────────────────────────────

export function createDeleteCommand(store: ParkedSessionStore): CommandDef {
  return {
    name: "delete",
    description: "Delete a parked session",
    aliases: ["del", "rm"],
    handler: async (ctx: CommandContext) => {
      const name = ctx.args.trim();
      if (!name) {
        await ctx.reply("Usage: `/delete <session-name>`");
        return;
      }
      const removed = store.remove(name);
      if (removed) {
        store.saveToDisk();
        await ctx.reply(`Deleted session '${name}'.`);
      } else {
        await ctx.reply(`Session '${name}' not found.`);
      }
    },
  };
}

// ─── /history ────────────────────────────────────────────────────────────────

export function createHistoryCommand(engine: Engine): CommandDef {
  return {
    name: "history",
    description: "Show session history summary",
    handler: async (ctx: CommandContext) => {
      const key = engine.buildSessionKey(ctx.userID);
      const state = engine.getState(key);
      const meta = engine.sessionMgr.get(key);

      if (!meta) {
        await ctx.reply("No session history found.");
        return;
      }

      const lines = [
        `**Session History**`,
        `- Session key: \`${key}\``,
        `- Agent: \`${meta.agentName}\``,
        `- Model: \`${meta.model || "default"}\``,
        `- Last active: ${timeAgo(Date.now() - meta.lastActiveAt)}`,
        `- Status: ${state ? "active (in conversation)" : "idle"}`,
      ];
      if (meta.cliSessionId) {
        lines.push(`- CLI session: \`${meta.cliSessionId.slice(0, 8)}...\``);
        lines.push(`\n> Full conversation history is maintained by the Claude CLI session. Send a message to continue.`);
      }
      await ctx.reply(lines.join("\n"));
    },
  };
}

// ─── /compress ───────────────────────────────────────────────────────────────

export function createCompressCommand(engine: Engine): CommandDef {
  return {
    name: "compress",
    description: "Compress context by resetting the session",
    aliases: ["compact"],
    handler: async (ctx: CommandContext) => {
      const key = engine.buildSessionKey(ctx.userID);
      await engine.resetSession(key);
      await ctx.reply("Context compressed (session reset). Send a message to continue with a fresh context.");
    },
  };
}

// ─── /whoami ─────────────────────────────────────────────────────────────────

export function createWhoamiCommand(): CommandDef {
  return {
    name: "whoami",
    description: "Show your user ID and platform info",
    aliases: ["myid"],
    handler: async (ctx: CommandContext) => {
      const lines = [
        `**User Info**`,
        `- User ID: \`${ctx.userID}\``,
        `- Chat ID: \`${ctx.chatID}\``,
        `- Chat type: ${ctx.chatType}`,
        `- Platform: ${ctx.platform}`,
      ];
      await ctx.reply(lines.join("\n"));
    },
  };
}

// ─── /version ────────────────────────────────────────────────────────────────

export function createVersionCommand(): CommandDef {
  let version = "unknown";
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf-8"));
    version = pkg.version ?? "unknown";
  } catch { /* ignore */ }

  return {
    name: "version",
    description: "Show application version",
    aliases: ["ver"],
    handler: async (ctx: CommandContext) => {
      await ctx.reply(`**Feishu AI Assistant** v${version}`);
    },
  };
}
