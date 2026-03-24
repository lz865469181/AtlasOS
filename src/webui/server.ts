import express from "express";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readRawConfig, writeRawConfig, getConfigPath, getConfig } from "../config.js";
import { subscribe, unsubscribe, getHistory } from "./events.js";
import { allAdapters } from "../platform/registry.js";
import { TOOL_API_KEY_ENV } from "../tools/index.js";
import { SearchService } from "../tools/index.js";
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

  // Verify on mutating methods
  if (["POST", "PUT", "DELETE"].includes(req.method)) {
    const cookie = req.cookies?.csrf_token;
    const header = req.headers["x-csrf-token"];
    if (!cookie || cookie !== header) {
      res.status(403).json({ error: "CSRF token mismatch" });
      return;
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

export function startWebUI(port: number): Server {
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
