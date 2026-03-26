import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { createAuthMiddleware } from "./auth.js";
import { ManagementServer } from "./server.js";

// ─── Auth Middleware Tests ─────────────────────────────────────────────────

describe("createAuthMiddleware", () => {
  const TOKEN = "test-secret-token";
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use("/api", createAuthMiddleware(TOKEN));
    app.get("/api/ping", (_req, res) => res.json({ ok: true }));

    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(() => {
    server?.close();
  });

  it("accepts valid Bearer token", async () => {
    const res = await fetch(`${baseUrl}/api/ping`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("accepts valid query param token", async () => {
    const res = await fetch(`${baseUrl}/api/ping?token=${TOKEN}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("rejects missing token with 401", async () => {
    const res = await fetch(`${baseUrl}/api/ping`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("unauthorized");
  });

  it("rejects invalid Bearer token with 401", async () => {
    const res = await fetch(`${baseUrl}/api/ping`, {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("rejects invalid query param token with 401", async () => {
    const res = await fetch(`${baseUrl}/api/ping?token=wrong`);
    expect(res.status).toBe(401);
  });
});

// ─── Status Endpoint Tests ─────────────────────────────────────────────────

describe("ManagementServer /api/v1/status", () => {
  const TOKEN = "mgmt-test-token";
  let mgmt: ManagementServer;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    // Create a minimal mock engine
    const mockEngine = {
      agentName: "test-agent",
      platformNames: ["feishu", "telegram"],
      startedAt: Date.now(),
      cronManager: null,
      sessionMgr: {
        list: () => [],
        get: () => undefined,
        delete: () => {},
      },
    };

    mgmt = new ManagementServer({
      port: 0, // will be overridden
      token: TOKEN,
      engine: mockEngine as any,
      config: { agent: {}, channels: {}, gateway: {}, health: {}, logging: {}, memory: {}, webui: {} } as any,
    });

    // Start on random port
    await new Promise<void>((resolve) => {
      server = mgmt.start();
      server.on("listening", () => resolve());
    });
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(() => {
    mgmt.stop();
  });

  it("returns correct status shape", async () => {
    const res = await fetch(`${baseUrl}/api/v1/status`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({
      version: "2.0.0",
      connected_platforms: ["feishu", "telegram"],
      agent_name: "test-agent",
    });
    expect(typeof body.data.uptime_seconds).toBe("number");
  });

  it("rejects unauthenticated request", async () => {
    const res = await fetch(`${baseUrl}/api/v1/status`);
    expect(res.status).toBe(401);
  });
});
