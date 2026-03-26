import express from "express";
import type { Server } from "node:http";
import type { Engine } from "../engine.js";
import type { AppConfig } from "../../config.js";
import { createAuthMiddleware } from "./auth.js";
import { success, failure } from "./types.js";
import { log } from "../logger.js";

export interface ManagementServerOpts {
  port: number;
  token: string;
  engine: Engine;
  config: AppConfig;
  corsOrigins?: string[];
}

export class ManagementServer {
  private app = express();
  private server: Server | null = null;
  private opts: ManagementServerOpts;

  constructor(opts: ManagementServerOpts) {
    this.opts = opts;
    this.setup();
  }

  private setup(): void {
    const { app, opts } = this;
    const { engine, config } = opts;

    app.use(express.json());

    // CORS
    if (opts.corsOrigins && opts.corsOrigins.length > 0) {
      const allowed = new Set(opts.corsOrigins);
      app.use((req, res, next) => {
        const origin = req.headers.origin;
        if (origin && allowed.has(origin)) {
          res.setHeader("Access-Control-Allow-Origin", origin);
          res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
        }
        if (req.method === "OPTIONS") {
          res.sendStatus(204);
          return;
        }
        next();
      });
    }

    // Auth
    app.use("/api/v1", createAuthMiddleware(opts.token));

    // ─── System ──────────────────────────────────────────────────────

    app.get("/api/v1/status", (_req, res) => {
      res.json(success({
        version: "2.0.0",
        uptime_seconds: Math.floor(process.uptime()),
        connected_platforms: engine.platformNames,
        agent_name: engine.agentName,
      }));
    });

    app.get("/api/v1/config", (_req, res) => {
      const redacted = redactSecrets(JSON.parse(JSON.stringify(config)));
      res.json(success(redacted));
    });

    app.post("/api/v1/restart", (_req, res) => {
      res.json(success({ message: "Restarting..." }));
      setTimeout(() => process.exit(0), 500);
    });

    // ─── Sessions ────────────────────────────────────────────────────

    app.get("/api/v1/sessions", (_req, res) => {
      const sessions = engine.sessionMgr.list();
      res.json(success(sessions));
    });

    app.delete("/api/v1/sessions/:key", (req, res) => {
      const key = req.params.key;
      const existing = engine.sessionMgr.get(key);
      if (!existing) {
        res.status(404).json(failure("session not found"));
        return;
      }
      engine.sessionMgr.delete(key);
      res.json(success({ deleted: key }));
    });

    // ─── Cron ────────────────────────────────────────────────────────

    app.get("/api/v1/cron", (_req, res) => {
      const cronMgr = engine.cronManager;
      if (!cronMgr) {
        res.json(success([]));
        return;
      }
      res.json(success(cronMgr.list()));
    });
  }

  start(): Server {
    this.server = this.app.listen(this.opts.port, () => {
      log("info", `Management API listening on http://127.0.0.1:${this.opts.port}`);
    });
    return this.server;
  }

  stop(): void {
    this.server?.close();
  }
}

/** Replace sensitive config values with "***". */
const SECRET_KEYS = new Set(["api_key", "app_secret", "bot_token", "token"]);

function redactSecrets(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return obj;
  if (Array.isArray(obj)) return obj.map(redactSecrets);
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      if (SECRET_KEYS.has(key) && typeof val === "string" && val.length > 0) {
        result[key] = "***";
      } else {
        result[key] = redactSecrets(val);
      }
    }
    return result;
  }
  return obj;
}
