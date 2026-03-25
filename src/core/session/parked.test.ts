import { describe, it, expect } from "vitest";
import { ParkedSessionStore } from "./parked.js";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function tmpPath(): string {
  const dir = join(tmpdir(), `parked-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return join(dir, "parked.json");
}

describe("ParkedSessionStore", () => {
  it("parks and retrieves a session", () => {
    const store = new ParkedSessionStore();
    store.park({ name: "fix-bug", cliSessionId: "abc-123", parkedAt: Date.now() });
    const all = store.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe("fix-bug");
    expect(all[0]!.cliSessionId).toBe("abc-123");
  });

  it("retrieves by name", () => {
    const store = new ParkedSessionStore();
    store.park({ name: "task-a", cliSessionId: "id-a", parkedAt: Date.now() });
    store.park({ name: "task-b", cliSessionId: "id-b", parkedAt: Date.now() });
    expect(store.get("task-a")?.cliSessionId).toBe("id-a");
    expect(store.get("task-b")?.cliSessionId).toBe("id-b");
    expect(store.get("nope")).toBeUndefined();
  });

  it("removes by name", () => {
    const store = new ParkedSessionStore();
    store.park({ name: "tmp", cliSessionId: "x", parkedAt: Date.now() });
    expect(store.remove("tmp")).toBe(true);
    expect(store.list()).toHaveLength(0);
    expect(store.remove("tmp")).toBe(false);
  });

  it("overwrites existing session with same name", () => {
    const store = new ParkedSessionStore();
    store.park({ name: "dup", cliSessionId: "old", parkedAt: 100 });
    store.park({ name: "dup", cliSessionId: "new", parkedAt: 200 });
    expect(store.list()).toHaveLength(1);
    expect(store.get("dup")?.cliSessionId).toBe("new");
  });

  it("persists to disk and loads back", () => {
    const path = tmpPath();
    const store1 = new ParkedSessionStore(path);
    store1.park({ name: "s1", cliSessionId: "id1", parkedAt: Date.now() });
    store1.saveToDisk();

    const store2 = new ParkedSessionStore(path);
    store2.loadFromDisk();
    expect(store2.list()).toHaveLength(1);
    expect(store2.get("s1")?.cliSessionId).toBe("id1");
  });

  it("loadFromDisk handles missing file gracefully", () => {
    const store = new ParkedSessionStore("/nonexistent/path/parked.json");
    expect(() => store.loadFromDisk()).not.toThrow();
    expect(store.list()).toHaveLength(0);
  });

  it("lists sorted by parkedAt descending", () => {
    const store = new ParkedSessionStore();
    store.park({ name: "old", cliSessionId: "a", parkedAt: 100 });
    store.park({ name: "new", cliSessionId: "b", parkedAt: 300 });
    store.park({ name: "mid", cliSessionId: "c", parkedAt: 200 });
    const names = store.list().map((s) => s.name);
    expect(names).toEqual(["new", "mid", "old"]);
  });
});
