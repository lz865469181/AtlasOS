import { join } from "node:path";
import { loadConfig, parseDuration } from "./config.js";
import { SessionManager, SessionQueue } from "./session/index.js";
import { AVAILABLE_MODELS, DEFAULT_MODEL } from "./session/session.js";
import { Workspace, getDefaultWorkspaceRoot } from "./workspace/workspace.js";
import { ContextManager } from "./context/manager.js";
import { MemoryExtractor } from "./memory/extractor.js";
import { FeishuAdapter } from "./platform/feishu/adapter.js";
import { registerAdapter, allAdapters } from "./platform/registry.js";
import { createRouter } from "./router/router.js";
import { startWebUI } from "./webui/server.js";
import { emit } from "./webui/events.js";
import { Scheduler } from "./scheduler/index.js";

function log(level: string, msg: string, meta?: Record<string, unknown>): void {
  const entry = { time: new Date().toISOString(), level, msg, ...meta };
  console.log(JSON.stringify(entry));
  emit("log", { level, content: msg, ts: new Date().toISOString(), ...meta });
}

async function main(): Promise<void> {
  // Load configuration
  const config = loadConfig();
  log("info", "Configuration loaded");

  // Initialize workspace — use platform-aware default when workspace_root is empty
  const agentID = "default";
  const workspaceRoot = config.agent.workspace_root || getDefaultWorkspaceRoot();
  const workspace = new Workspace(workspaceRoot, agentID);
  workspace.init();
  log("info", "Workspace initialized", { root: workspaceRoot });

  // Initialize session management — with disk persistence
  const sessionTtlMs = parseDuration(config.gateway.session_ttl);
  const sessionsPath = join(workspace.agentDir, "sessions.json");
  const sessionManager = new SessionManager(sessionTtlMs, sessionsPath);
  sessionManager.loadFromDisk();
  const sessionQueue = new SessionQueue();
  // Wire up queue cleanup when sessions expire
  sessionManager.onSessionRemoved = (key) => sessionQueue.remove(key);
  log("info", "Session manager ready", { ttlMs: sessionTtlMs, sessions: sessionManager.size });

  // Initialize context manager for conversation summarization
  const contextManager = new ContextManager({
    maxTokens: Math.floor((config.gateway.context_compress_threshold ?? 0.8) * 200_000),
  });

  // Initialize memory extractor for long-term fact extraction
  const memoryExtractor = new MemoryExtractor(workspace);

  // Initialize scheduler for periodic background tasks
  const scheduler = new Scheduler();

  // Memory compaction: iterate all users' MEMORY.md files and compact if oversized
  if (config.memory.compaction.enabled) {
    scheduler.register({
      name: "memory-compaction",
      schedule: config.memory.compaction.schedule,
      enabled: true,
      handler: async () => {
        const users = workspace.listUsers();
        log("info", "Running memory compaction", { userCount: users.length });
        for (const userID of users) {
          await memoryExtractor.compact(userID).catch((err) => {
            log("warn", "Memory compaction failed for user", { userID, error: String(err) });
          });
        }
      },
    });
  }

  // Session save: periodic save to disk (in addition to debounced saves)
  scheduler.register({
    name: "session-persist",
    schedule: "*/10 * * * *", // every 10 minutes
    enabled: true,
    handler: async () => {
      sessionManager.saveToDisk();
    },
  });

  scheduler.start();

  // Create router
  const router = createRouter({ sessionManager, sessionQueue, workspace, contextManager, memoryExtractor });

  // Start WebUI
  let webuiServer: import("node:http").Server | null = null;
  if (config.webui.enabled) {
    webuiServer = startWebUI(config.webui.port, { sessionManager, workspace });
  }

  // Start platform adapters
  if (config.channels.feishu.enabled) {
    const uploadsRoot = join(workspace.usersDir);
    const feishu = new FeishuAdapter(
      config.channels.feishu.app_id,
      config.channels.feishu.app_secret,
      uploadsRoot,
    );

    // Handle card button clicks (model selection, clarification replies, etc.)
    feishu.onCardAction(async (event, sender) => {
      const { userID, chatID, value } = event;

      if (value.action === "select_model") {
        const modelId = value.model as string;
        if (modelId && AVAILABLE_MODELS[modelId]) {
          const agentID = workspace.agentID;
          const session = sessionManager.getOrCreate(agentID, userID);
          session.model = modelId;
          log("info", "User switched model", { userID, model: modelId });
          await sender.sendText(chatID, `Model switched to: ${AVAILABLE_MODELS[modelId]} (${modelId})`);
        }
      } else if (value.action === "clarification_reply") {
        // User clicked a clarification option — inject as new message
        const reply = value.reply as string;
        if (reply) {
          log("info", "Clarification reply received", { userID, reply });
          await sender.sendText(chatID, `You chose: ${reply}`);
          // Route as a regular message so the conversation continues
          const syntheticEvent: import("./platform/types.js").MessageEvent = {
            platform: "feishu",
            messageID: `card-${Date.now()}`,
            chatID,
            chatType: "p2p",
            userID,
            text: reply,
            isMention: false,
          };
          try {
            await router(syntheticEvent, sender);
          } catch (err) {
            log("error", "Card action router error", { userID, error: String(err) });
          }
        }
      } else if (value.action === "clarification_skip") {
        log("info", "Clarification skipped, waiting for text reply", { userID });
      }
    });

    registerAdapter(feishu);
  }

  for (const adapter of allAdapters()) {
    try {
      await adapter.start(router);
      log("info", `Platform adapter started: ${adapter.name}`);
    } catch (err) {
      log("error", `Failed to start adapter: ${adapter.name}`, { error: String(err) });
    }
  }

  log("info", "Feishu AI Assistant started", {
    adapters: allAdapters().map((a) => a.name),
    webui: config.webui.enabled ? `http://127.0.0.1:${config.webui.port}` : "disabled",
  });

  // Graceful shutdown
  const shutdown = async () => {
    log("info", "Shutting down...");

    for (const adapter of allAdapters()) {
      try {
        await adapter.stop();
      } catch {
        // Ignore
      }
    }

    sessionManager.dispose();
    sessionQueue.dispose();
    scheduler.stop();

    if (webuiServer) {
      webuiServer.close();
    }

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
