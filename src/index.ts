import { join } from "node:path";
import { loadConfig, parseDuration } from "./config.js";
import { log } from "./core/logger.js";
import { Engine } from "./core/engine.js";
import { Workspace, getDefaultWorkspaceRoot } from "./core/workspace/workspace.js";
import { CronManager } from "./core/cron.js";
import { RateLimiter, UserRoleManager } from "./core/ratelimit.js";
import { RelayManager } from "./core/relay.js";
import { ContextManager } from "./core/context.js";
import { MemoryManager } from "./core/memory.js";
import { WhisperSTT, type SpeechToText } from "./core/stt.js";
import { createTTS, type TextToSpeech } from "./core/tts.js";
import { createAgent, registerAgent } from "./agent/registry.js";
import { ClaudeAgent } from "./agent/claude/agent.js";
import { CodexAgent } from "./agent/codex/agent.js";
import { GeminiAgent } from "./agent/gemini/agent.js";
import { CursorAgent } from "./agent/cursor/agent.js";
import { OpenCodeAgent } from "./agent/opencode/agent.js";
import { registerAdapter, allAdapters } from "./platform/registry.js";
import { FeishuAdapter } from "./platform/feishu/adapter.js";
import { startWebUI } from "./webui/server.js";
import { emit } from "./webui/events.js";
import { createSessionsCommand, createResumeCommand } from "./core/command/builtins.js";

async function main(): Promise<void> {
  // Load configuration
  const config = loadConfig();
  log("info", "Configuration loaded");

  // Initialize workspace
  const agentID = "default";
  const workspaceRoot = config.agent.workspace_root || getDefaultWorkspaceRoot();
  const workspace = new Workspace(workspaceRoot, agentID);
  workspace.init();
  log("info", "Workspace initialized", { root: workspaceRoot });

  // Register all agent backends
  // (Each agent class calls registerAgent in its module, but we also
  //  register here to ensure they're loaded)
  const backend = config.agent.backend ?? "claude";

  // Create the agent for this instance
  const agent = (() => {
    switch (backend) {
      case "claude": return new ClaudeAgent();
      case "codex": return new CodexAgent();
      case "gemini": return new GeminiAgent();
      case "cursor": return new CursorAgent();
      case "opencode": return new OpenCodeAgent();
      default: return new ClaudeAgent();
    }
  })();

  // Create Engine
  const sessionTtlMs = parseDuration(config.gateway.session_ttl);
  const engine = new Engine(agent, {
    project: agentID,
    dataDir: workspace.agentDir,
    sessionTtlMs,
    persistPath: join(workspace.agentDir, "sessions.json"),
  });

  // Register builtin commands
  engine.commands.register(createSessionsCommand(engine.parkedSessions));
  engine.commands.register(createResumeCommand(engine.parkedSessions, async (cliSessionId, ctx) => {
    log("info", "Resumed parked session", { cliSessionId, userID: ctx.userID });
  }));

  // ─── Rate Limiting & ACL ─────────────────────────────────────────────
  let rateLimiter: RateLimiter | undefined;
  const roleManager = new UserRoleManager();

  if (config.access_control?.rate_limit) {
    rateLimiter = new RateLimiter({
      maxMessages: config.access_control.rate_limit.max_messages,
      windowMs: parseDuration(config.access_control.rate_limit.window),
    });
    log("info", "Rate limiter initialized");
  }

  if (config.access_control?.roles) {
    roleManager.configure(
      config.access_control.roles.map((r) => ({
        name: r.name,
        userIDs: r.user_ids,
        disabledCommands: r.disabled_commands,
        rateLimit: r.rate_limit ? {
          maxMessages: r.rate_limit.max_messages,
          windowMs: parseDuration(r.rate_limit.window),
        } : undefined,
      })),
      config.access_control.default_role,
    );
    log("info", "Role-based ACL configured");
  }

  // ─── Cron Manager ────────────────────────────────────────────────────
  let cronManager: CronManager | undefined;
  if (config.cron?.enabled) {
    const cronPath = config.cron.data_path ?? join(workspace.agentDir, "crons.json");
    cronManager = new CronManager(cronPath);
    log("info", "Cron manager initialized");
  }

  // ─── Relay Manager ───────────────────────────────────────────────────
  let relayManager: RelayManager | undefined;
  if (config.relay?.enabled) {
    relayManager = new RelayManager({ timeoutMs: config.relay.timeout_ms });
    log("info", "Relay manager initialized");
  }

  // ─── Voice (STT/TTS) ────────────────────────────────────────────────
  let stt: SpeechToText | undefined;
  let tts: TextToSpeech | undefined;

  if (config.voice?.stt?.enabled) {
    stt = new WhisperSTT({
      provider: config.voice.stt.provider,
      apiKey: config.voice.stt.api_key,
      baseUrl: config.voice.stt.base_url,
      model: config.voice.stt.model,
      language: config.voice.stt.language,
    });
    log("info", "STT initialized", { provider: config.voice.stt.provider });
  }

  if (config.voice?.tts?.enabled) {
    tts = createTTS(config.voice.tts) ?? undefined;
    if (tts) log("info", "TTS initialized", { provider: config.voice.tts.provider });
  }

  // ─── Start Platform Adapters ─────────────────────────────────────────

  // Feishu
  if (config.channels.feishu.enabled) {
    const uploadsRoot = workspace.usersDir;
    const feishu = new FeishuAdapter(
      config.channels.feishu.app_id,
      config.channels.feishu.app_secret,
      uploadsRoot,
    );
    engine.addPlatform(feishu);
  }

  // Telegram
  if (config.channels.telegram?.enabled) {
    try {
      const { TelegramAdapter } = await import("./platform/telegram/adapter.js");
      const telegram = new TelegramAdapter(
        (config.channels.telegram as any).bot_token,
        { allowFrom: config.access_control?.allow_from },
      );
      engine.addPlatform(telegram);
    } catch (err) {
      log("error", "Failed to load Telegram adapter", { error: String(err) });
    }
  }

  // Discord
  if (config.channels.discord?.enabled) {
    try {
      const { DiscordAdapter } = await import("./platform/discord/adapter.js");
      const discord = new DiscordAdapter(
        (config.channels.discord as any).bot_token,
        { allowFrom: config.access_control?.allow_from },
      );
      engine.addPlatform(discord);
    } catch (err) {
      log("error", "Failed to load Discord adapter", { error: String(err) });
    }
  }

  // DingTalk
  if (config.channels.dingtalk?.enabled) {
    try {
      const { DingTalkAdapter } = await import("./platform/dingtalk/adapter.js");
      const dingtalk = new DingTalkAdapter(
        (config.channels.dingtalk as any).app_key,
        (config.channels.dingtalk as any).app_secret,
      );
      engine.addPlatform(dingtalk);
    } catch (err) {
      log("error", "Failed to load DingTalk adapter", { error: String(err) });
    }
  }

  // Wire cron trigger handler
  if (cronManager) {
    cronManager.setTriggerHandler(async (job) => {
      const platform = engine.platforms.find((a) => a.name === job.platform);
      if (!platform) return;
      const sender = platform.getSender();
      const event = {
        platform: job.platform,
        messageID: `cron-${Date.now()}`,
        chatID: job.chatID,
        chatType: "p2p" as const,
        userID: job.userID,
        text: job.prompt,
        isMention: true,
      };
      await engine.handleMessage(event, sender, platform);
    });
    cronManager.startAll();
  }

  // Start WebUI
  let webuiServer: import("node:http").Server | null = null;
  if (config.webui.enabled) {
    webuiServer = startWebUI(config.webui.port, {
      workspace,
      parkedSessions: engine.parkedSessions,
    });
  }

  // Start Engine (starts all platform adapters)
  await engine.start();

  log("info", "AI Assistant started", {
    backend,
    platforms: engine.platforms.map((a) => a.name),
    features: {
      cron: !!cronManager,
      relay: !!relayManager,
      stt: !!stt,
      tts: !!tts,
      rateLimiting: !!rateLimiter,
    },
    webui: config.webui.enabled ? `http://127.0.0.1:${config.webui.port}` : "disabled",
  });

  // Graceful shutdown
  const shutdown = async () => {
    log("info", "Shutting down...");
    cronManager?.stopAll();
    rateLimiter?.dispose();
    roleManager.dispose();
    await engine.stop();
    if (webuiServer) webuiServer.close();
    log("info", "Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
