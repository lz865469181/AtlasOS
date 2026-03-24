import express from "express";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readRawConfig, writeRawConfig, getConfigPath, getConfig } from "../config.js";
import { subscribe, unsubscribe, getHistory, emit } from "./events.js";
import { allAdapters, getAdapter } from "../platform/registry.js";
import { TOOL_API_KEY_ENV } from "../tools/index.js";
import { SearchService } from "../tools/index.js";
import { listRecentSessions, findSessionFile, extractSessionMeta } from "../claude/sessions.js";
import type { SessionManager } from "../session/manager.js";
import type { Workspace } from "../workspace/workspace.js";
import type { Server } from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Static files are always under src/webui/static/, resolve from __dirname
const staticDir = existsSync(join(__dirname, "static"))
  ? join(__dirname, "static")
  : resolve(__dirname, "../../src/webui/static");
const startedAt = Date.now();

function log(level: string, msg: string, meta?: Record<string, unknown>): void {
  const entry = { time: new Date().toISOString(), level, msg, ...meta };
  console.log(JSON.stringify(entry));
}

// --- Middleware ---

function localhostOnly(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  const ip = req.ip ?? req.socket.remoteAddress ?? "";
  if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") {
    next();
    return;
  }
  res.status(403).json({ error: "Localhost only" });
}

function csrfMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  // Set CSRF cookie if not present
  if (!req.cookies?.csrf_token) {
    const token = randomHex(32);
    res.cookie("csrf_token", token, { httpOnly: false, sameSite: "strict" });
  }

  // Verify on mutating methods (exempt /api/reuse for programmatic CLI access)
  if (["POST", "PUT", "DELETE"].includes(req.method)) {
    const isReuseEndpoint = req.path === "/api/reuse"
      || (req.method === "DELETE" && req.path === "/api/reuse/inbox");
    if (!isReuseEndpoint) {
      const cookie = req.cookies?.csrf_token;
      const header = req.headers["x-csrf-token"];
      if (!cookie || cookie !== header) {
        res.status(403).json({ error: "CSRF token mismatch" });
        return;
      }
    }
  }

  next();
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

// --- Secrets helpers ---

function getSecretKeys(): string[] {
  // Scan config for ${VAR} placeholders
  const raw = readRawConfig();
  const matches = raw.matchAll(/\$\{([^}]+)\}/g);
  const keys = new Set<string>();
  for (const m of matches) {
    keys.add(m[1]!);
  }
  return [...keys].sort();
}

function maskValue(val: string): string {
  if (!val) return "";
  if (val.length <= 4) return "****";
  return val.slice(0, 2) + "*".repeat(Math.min(val.length - 4, 20)) + val.slice(-2);
}

// --- Server ---

export interface WebUIDeps {
  sessionManager?: SessionManager;
  workspace?: Workspace;
}

export function startWebUI(port: number, deps?: WebUIDeps): Server {
  const app = express();

  // Parse JSON & cookies
  app.use(express.json());
  app.use(cookieParser());

  // Security
  app.use(localhostOnly);
  app.use(csrfMiddleware);

  // Static files
  app.use(express.static(staticDir));

  // --- API Routes ---

  app.get("/api/config", (_req, res) => {
    try {
      const raw = readRawConfig();
      res.type("json").send(raw);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/config", (req, res) => {
    try {
      const json = JSON.stringify(req.body, null, 2);
      writeRawConfig(json);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/secrets", (_req, res) => {
    const keys = getSecretKeys();
    const secrets = keys.map((key) => ({
      key,
      is_set: !!process.env[key],
      masked: process.env[key] ? maskValue(process.env[key]!) : "",
    }));
    res.json(secrets);
  });

  app.post("/api/secrets", (req, res) => {
    const { key, value } = req.body;
    if (!key || typeof key !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(key)) {
      res.status(400).json({ error: "Invalid key format" });
      return;
    }
    // Block dangerous env vars that could enable code injection or path hijacking
    const BLOCKED_KEYS = new Set([
      "NODE_OPTIONS", "NODE_PATH", "PATH", "LD_PRELOAD", "LD_LIBRARY_PATH",
      "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH", "HOME", "USERPROFILE",
      "COMSPEC", "SHELL", "EDITOR", "VISUAL", "PYTHONPATH",
    ]);
    if (BLOCKED_KEYS.has(key)) {
      res.status(403).json({ error: `Setting ${key} is not allowed` });
      return;
    }
    // Only allow keys referenced in config (${VAR} placeholders)
    const allowedKeys = new Set(getSecretKeys());
    if (!allowedKeys.has(key)) {
      res.status(400).json({ error: `Key ${key} is not referenced in config` });
      return;
    }
    if (!value || typeof value !== "string") {
      res.status(400).json({ error: "Value required" });
      return;
    }
    process.env[key] = value;
    res.json({ ok: true });
  });

  app.delete("/api/secrets", (req, res) => {
    const { key } = req.body;
    if (!key) {
      res.status(400).json({ error: "Key required" });
      return;
    }
    delete process.env[key];
    res.json({ ok: true });
  });

  app.get("/api/status", (_req, res) => {
    const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
    res.json({
      uptime_seconds: uptimeSeconds,
      config_path: getConfigPath(),
      platform: process.platform,
      node_version: process.version,
      current_time: new Date().toISOString(),
    });
  });

  app.get("/api/channels", (_req, res) => {
    try {
      const cfg = getConfig();
      const registeredAdapters = new Set(allAdapters().map((a) => a.name));
      const channels = Object.entries(cfg.channels).map(([name, ch]) => ({
        name,
        enabled: !!ch.enabled,
        connected: registeredAdapters.has(name),
        fields: Object.fromEntries(
          Object.entries(ch)
            .filter(([k]) => k !== "enabled")
            .map(([k, v]) => [k, typeof v === "string" && v.length > 4 ? v.slice(0, 2) + "****" + v.slice(-2) : v]),
        ),
      }));
      res.json(channels);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    subscribe(res);

    req.on("close", () => {
      unsubscribe(res);
    });
  });

  app.get("/api/events/history", (_req, res) => {
    res.json(getHistory());
  });

  app.post("/api/restart", (_req, res) => {
    res.json({ ok: true, message: "Restarting..." });
    // Spawn a new process with the same entry point, then exit current
    setTimeout(() => {
      const entryScript = process.argv[1];
      if (!entryScript) {
        log("error", "Cannot restart: no entry script found in process.argv");
        return;
      }
      // Spawn detached child with same node/tsx + script
      const child = spawn(process.execPath, process.argv.slice(1), {
        cwd: process.cwd(),
        env: process.env,
        stdio: "inherit",
        detached: true,
      });
      child.unref();
      log("info", "Spawned new process, exiting current");
      process.exit(0);
    }, 500);
  });

  // --- Tools API keys ---

  app.get("/api/tools/keys", (_req, res) => {
    const keys = Object.entries(TOOL_API_KEY_ENV).map(([id, envVar]) => ({
      id,
      env_var: envVar,
      is_set: !!process.env[envVar],
      masked: process.env[envVar] ? maskValue(process.env[envVar]!) : "",
    }));
    res.json(keys);
  });

  app.post("/api/tools/keys", (req, res) => {
    const { env_var, value } = req.body;
    if (!env_var || typeof env_var !== "string") {
      res.status(400).json({ error: "env_var required" });
      return;
    }
    // Validate it's a known tool env var
    const validKeys = Object.values(TOOL_API_KEY_ENV);
    if (!validKeys.includes(env_var)) {
      res.status(400).json({ error: `Unknown tool env var: ${env_var}` });
      return;
    }
    if (!value || typeof value !== "string") {
      res.status(400).json({ error: "value required" });
      return;
    }
    process.env[env_var] = value;
    log("info", "Tool API key set via WebUI", { env_var });
    res.json({ ok: true });
  });

  app.delete("/api/tools/keys", (req, res) => {
    const { env_var } = req.body;
    if (!env_var) {
      res.status(400).json({ error: "env_var required" });
      return;
    }
    delete process.env[env_var];
    log("info", "Tool API key removed via WebUI", { env_var });
    res.json({ ok: true });
  });

  app.get("/api/tools/status", (_req, res) => {
    const service = new SearchService();
    res.json(service.getProviderStatus());
  });

  // --- /api/reuse: CLI-to-Feishu session bridging ---
  // Allows a local CLI session to push its current output to Feishu and
  // attach the Feishu bot to the same CLI session for continued conversation.
  //
  // POST /api/reuse
  // Body: {
  //   sessionId?: string,   // CLI session UUID (auto-detects latest if omitted)
  //   message?: string,     // Message to send to Feishu (e.g. current CLI output)
  //   userID?: string,      // Feishu open_id (uses first active session user if omitted)
  //   chatID?: string,      // Feishu chat_id (uses user's last active chat if omitted)
  // }
  app.post("/api/reuse", async (req, res) => {
    try {
      const { sessionId, message, userID, chatID } = req.body ?? {};
      const sessionManager = deps?.sessionManager;
      const workspace = deps?.workspace;

      if (!sessionManager || !workspace) {
        res.status(503).json({ error: "Session manager not available" });
        return;
      }

      // 1. Resolve the CLI session to attach
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      let resolvedSessionId: string;
      let meta: { cwd: string; gitBranch?: string; entrypoint?: string };

      if (sessionId) {
        if (!UUID_RE.test(sessionId)) {
          res.status(400).json({ error: "Invalid session ID format. Expected a UUID." });
          return;
        }
        const found = findSessionFile(sessionId);
        if (!found) {
          res.status(404).json({ error: `Session ${sessionId} not found` });
          return;
        }
        resolvedSessionId = sessionId;
        const extracted = extractSessionMeta(found);
        if (!extracted) {
          res.status(400).json({ error: "Failed to read session metadata" });
          return;
        }
        meta = extracted;
      } else {
        // Auto-detect latest CLI session
        const recent = listRecentSessions(1);
        if (recent.length === 0) {
          res.status(404).json({ error: "No local CLI sessions found" });
          return;
        }
        const latest = recent[0]!;
        resolvedSessionId = latest.sessionId;
        meta = { cwd: latest.cwd, gitBranch: latest.gitBranch, entrypoint: latest.entrypoint };
      }

      // 2. Get the Feishu adapter and sender
      const feishuAdapter = getAdapter("feishu");
      if (!feishuAdapter) {
        res.status(503).json({ error: "Feishu adapter not available" });
        return;
      }
      const sender = feishuAdapter.getSender();

      // 3. Find or create the target session
      const agentID = workspace.agentID;
      let resolvedUserID = userID;
      let resolvedChatID = chatID;

      // If no userID specified, try to find the most recently active feishu session
      if (!resolvedUserID) {
        resolvedUserID = sessionManager.findMostRecentUserID();
      }

      if (!resolvedUserID) {
        res.status(400).json({ error: "No userID provided and no active Feishu sessions found. Please specify userID." });
        return;
      }

      // Resolve chatID: prefer explicit > session's lastChatID > error
      if (!resolvedChatID) {
        resolvedChatID = sessionManager.findLastChatID(agentID, resolvedUserID);
      }
      if (!resolvedChatID) {
        res.status(400).json({
          error: "No chatID provided and no recent chat found for this user. "
            + "The user must send at least one message to the bot first, or provide chatID explicitly.",
        });
        return;
      }

      // Attach the CLI session to the feishu bot session
      const session = sessionManager.getOrCreate(agentID, resolvedUserID);
      session.attachExternalSession(resolvedSessionId, meta.cwd);
      sessionManager.scheduleSave();

      log("info", "CLI session reused via API", {
        sessionId: resolvedSessionId,
        userID: resolvedUserID,
        chatID: resolvedChatID,
        cwd: meta.cwd,
      });
      emit("command", { command: "/reuse", source: "api", userID: resolvedUserID, sessionId: resolvedSessionId });

      // 4. Send notification + message to Feishu
      const branch = meta.gitBranch ? `\nBranch: \`${meta.gitBranch}\`` : "";
      const attachInfo = [
        `**Session Reused (from CLI)**`,
        ``,
        `Session: \`${resolvedSessionId}\``,
        `Project: \`${meta.cwd}\`${branch}`,
        ``,
        `Your Feishu chat is now attached to this CLI session. Send messages here to continue the conversation.`,
        `Use \`/detach\` to return to normal.`,
      ].join("\n");

      await sender.sendMarkdown(resolvedChatID, attachInfo);

      // Send the CLI output as a message if provided (truncate to 30KB)
      if (message && typeof message === "string" && message.trim()) {
        const MAX_MSG_LEN = 30_000;
        const truncated = message.trim().slice(0, MAX_MSG_LEN);
        const suffix = message.trim().length > MAX_MSG_LEN ? "\n\n_...truncated_" : "";
        await sender.sendMarkdown(resolvedChatID, `**CLI Output:**\n\n${truncated}${suffix}`);
      }

      res.json({
        ok: true,
        sessionId: resolvedSessionId,
        userID: resolvedUserID,
        chatID: resolvedChatID,
        cwd: meta.cwd,
        gitBranch: meta.gitBranch,
        inboxUrl: `/api/reuse/inbox?userID=${encodeURIComponent(resolvedUserID)}`,
      });
    } catch (err) {
      log("error", "Reuse API error", { error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/reuse/status — Check current reuse state for a user
  app.get("/api/reuse/status", (req, res) => {
    const sessionManager = deps?.sessionManager;
    const workspace = deps?.workspace;
    if (!sessionManager || !workspace) {
      res.status(503).json({ error: "Session manager not available" });
      return;
    }

    const userID = req.query.userID as string;
    if (!userID) {
      res.status(400).json({ error: "userID query param required" });
      return;
    }

    const session = sessionManager.get(workspace.agentID, userID);
    if (!session) {
      res.json({ attached: false, message: "No active session for this user" });
      return;
    }

    res.json({
      attached: !!session.cliWorkDir,
      sessionId: session.cliSessionId,
      cliWorkDir: session.cliWorkDir ?? null,
    });
  });

  // GET /api/reuse/inbox — Poll for Feishu replies written to the inbox file
  app.get("/api/reuse/inbox", (req, res) => {
    const workspace = deps?.workspace;
    if (!workspace) {
      res.status(503).json({ error: "Workspace not available" });
      return;
    }

    const userID = req.query.userID as string;
    if (!userID) {
      res.status(400).json({ error: "userID query param required" });
      return;
    }

    const since = Number(req.query.since) || 0;
    const inboxFile = workspace.inboxPath(userID);

    if (!existsSync(inboxFile)) {
      res.json({ messages: [], lastTs: since });
      return;
    }

    try {
      const lines = readFileSync(inboxFile, "utf-8").split("\n").filter(Boolean);
      const messages: Array<Record<string, unknown>> = [];
      let lastTs = since;

      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.ts > since) {
            messages.push(msg);
            if (msg.ts > lastTs) lastTs = msg.ts;
          }
        } catch { /* skip malformed lines */ }
      }

      res.json({ messages, lastTs });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // DELETE /api/reuse/inbox — Clear the inbox file (called on detach or manual cleanup)
  app.delete("/api/reuse/inbox", (req, res) => {
    const workspace = deps?.workspace;
    if (!workspace) {
      res.status(503).json({ error: "Workspace not available" });
      return;
    }

    const userID = req.query.userID as string;
    if (!userID) {
      res.status(400).json({ error: "userID query param required" });
      return;
    }

    const inboxFile = workspace.inboxPath(userID);
    if (existsSync(inboxFile)) {
      writeFileSync(inboxFile, "", "utf-8");
    }

    res.json({ ok: true });
  });

  const server = app.listen(port, "127.0.0.1", () => {
    log("info", `WebUI server listening on http://127.0.0.1:${port}`);
  });

  return server;
}

/** Minimal cookie parser middleware (avoids extra dependency). */
function cookieParser() {
  return (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const header = req.headers.cookie ?? "";
    const cookies: Record<string, string> = {};
    for (const part of header.split(";")) {
      const [key, ...rest] = part.trim().split("=");
      if (key) cookies[key] = rest.join("=");
    }
    (req as any).cookies = cookies;
    next();
  };
}

// Extend Express Request type
declare module "express" {
  interface Request {
    cookies?: Record<string, string>;
  }
}
