import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolve } from "node:path";
import { WorkspacePool } from "./pool.js";
import type { Agent } from "../../agent/types.js";

function mockAgent(name = "mock"): Agent {
  return {
    name,
    stop: vi.fn().mockResolvedValue(undefined),
    startSession: vi.fn() as Agent["startSession"],
    listSessions: vi.fn().mockResolvedValue([]),
  };
}

describe("WorkspacePool", () => {
  let pool: WorkspacePool;
  const agents: Agent[] = [];

  function createPool(opts: { idleTimeoutMs?: number; reapIntervalMs?: number } = {}) {
    agents.length = 0;
    pool = new WorkspacePool({
      createAgent: (workDir: string) => {
        const a = mockAgent(workDir);
        agents.push(a);
        return a;
      },
      idleTimeoutMs: opts.idleTimeoutMs ?? 60_000,
      // Use a very large value to prevent the reap timer from firing during tests
      reapIntervalMs: opts.reapIntervalMs ?? 2_000_000_000,
    });
    return pool;
  }

  afterEach(async () => {
    if (pool) await pool.stopAll();
  });

  it("getOrCreate creates agent on first call, returns same on second", () => {
    createPool();
    const absPath = resolve("/tmp/workspace-a");
    const first = pool.getOrCreate(absPath);
    const second = pool.getOrCreate(absPath);

    expect(first.agent).toBe(second.agent);
    expect(agents).toHaveLength(1);
  });

  it("get returns agent without creating", () => {
    createPool();
    const absPath = resolve("/tmp/workspace-b");

    expect(pool.get(absPath)).toBeUndefined();
    expect(agents).toHaveLength(0);

    pool.getOrCreate(absPath);
    expect(pool.get(absPath)).toBe(agents[0]);
  });

  it("has returns correct boolean", () => {
    createPool();
    const absPath = resolve("/tmp/workspace-c");

    expect(pool.has(absPath)).toBe(false);
    pool.getOrCreate(absPath);
    expect(pool.has(absPath)).toBe(true);
  });

  it("touch updates lastActivity", async () => {
    createPool();
    const absPath = resolve("/tmp/workspace-d");
    pool.getOrCreate(absPath);

    const before = pool.list()[0].idleMs;
    // Small delay so idle time increases
    await new Promise(r => setTimeout(r, 20));
    pool.touch(absPath);
    const after = pool.list()[0].idleMs;

    expect(after).toBeLessThan(before + 20);
  });

  it("list returns all workspaces with idle time", () => {
    createPool();
    pool.getOrCreate(resolve("/tmp/ws-1"));
    pool.getOrCreate(resolve("/tmp/ws-2"));

    const result = pool.list();
    expect(result).toHaveLength(2);
    for (const entry of result) {
      expect(entry).toHaveProperty("workspace");
      expect(entry).toHaveProperty("idleMs");
      expect(typeof entry.idleMs).toBe("number");
    }
  });

  it("reap removes idle entries", async () => {
    createPool({ idleTimeoutMs: 50, reapIntervalMs: 2_000_000_000 });
    const absPath = resolve("/tmp/workspace-reap");
    pool.getOrCreate(absPath);
    expect(pool.size).toBe(1);

    // Wait for the entry to become idle
    await new Promise(r => setTimeout(r, 80));

    // Trigger reap manually via getOrCreate of another workspace (reap is private,
    // so we expose it indirectly through a short-lived pool with a real timer)
    // Instead, create a pool with a very short reap interval:
    await pool.stopAll();

    pool = new WorkspacePool({
      createAgent: (workDir: string) => {
        const a = mockAgent(workDir);
        agents.push(a);
        return a;
      },
      idleTimeoutMs: 50,
      reapIntervalMs: 30,
    });

    pool.getOrCreate(absPath);
    expect(pool.size).toBe(1);

    await new Promise(r => setTimeout(r, 120));

    expect(pool.size).toBe(0);
  });

  it("stopAll stops all agents and clears pool", async () => {
    createPool();
    pool.getOrCreate(resolve("/tmp/ws-stop-1"));
    pool.getOrCreate(resolve("/tmp/ws-stop-2"));
    expect(pool.size).toBe(2);

    await pool.stopAll();

    expect(pool.size).toBe(0);
    for (const a of agents) {
      expect(a.stop).toHaveBeenCalled();
    }
  });

  it("path normalization gives same entry for trailing slash", () => {
    createPool();
    const base = resolve("/tmp/workspace-norm");
    pool.getOrCreate(base);
    pool.getOrCreate(base + "/");

    expect(pool.size).toBe(1);
    expect(agents).toHaveLength(1);
  });

  it("size reflects current entries", () => {
    createPool();
    expect(pool.size).toBe(0);
    pool.getOrCreate(resolve("/tmp/ws-size-1"));
    expect(pool.size).toBe(1);
    pool.getOrCreate(resolve("/tmp/ws-size-2"));
    expect(pool.size).toBe(2);
  });
});
