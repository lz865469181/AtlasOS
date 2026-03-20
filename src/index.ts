import { loadConfig, parseDuration } from "./config.js";
import { SessionManager, SessionQueue } from "./session/index.js";
import { AVAILABLE_MODELS } from "./session/session.js";
import { Workspace } from "./workspace/workspace.js";
import { FeishuAdapter } from "./platform/feishu/adapter.js";
import { registerAdapter, allAdapters } from "./platform/registry.js";
import { createRouter } from "./router/router.js";
import { startWebUI } from "./webui/server.js";
import { emit } from "./webui/events.js";

function log(level: string, msg: string, meta?: Record<string, unknown>): void {
  const entry = { time: new Date().toISOString(), level, msg, ...meta };
  console.log(JSON.stringify(entry));
  emit("log", { level, content: msg, ts: new Date().toISOString(), ...meta });
}

async function main(): Promise<void> {
  // Load configuration
  const config = loadConfig();
  log("info", "Configuration loaded");

  // Initialize workspace
  const agentID = "default";
  const workspace = new Workspace(config.agent.workspace_root, agentID);
  workspace.init();
  log("info", "Workspace initialized", { root: config.agent.workspace_root });

  // Initialize session management
  const sessionTtlMs = parseDuration(config.gateway.session_ttl);
  const sessionManager = new SessionManager(sessionTtlMs);
  const sessionQueue = new SessionQueue();
  log("info", "Session manager ready", { ttlMs: sessionTtlMs });

  // Create router
  const router = createRouter({ sessionManager, sessionQueue, workspace });

  // Start WebUI
  let webuiServer: import("node:http").Server | null = null;
  if (config.webui.enabled) {
    webuiServer = startWebUI(config.webui.port);
  }

  // Start platform adapters
  if (config.channels.feishu.enabled) {
    const feishu = new FeishuAdapter(
      config.channels.feishu.app_id,
      config.channels.feishu.app_secret,
    );

    // Handle card button clicks (e.g., /model selection)
    feishu.onCardAction(async (event, sender) => {
      const { userID, chatID, value } = event;
      if (value.action === "select_model") {
        const modelId = value.model as string;
        if (modelId && AVAILABLE_MODELS[modelId]) {
          const agentID = workspace.agentID;
          const session = sessionManager.getOrCreate(agentID, userID);
          session.model = modelId;
          log("info", "User switched model", { userID, model: modelId });
          await sender.sendText(
            chatID,
            `Model switched to: ${AVAILABLE_MODELS[modelId]} (${modelId})`,
          );
        }
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
