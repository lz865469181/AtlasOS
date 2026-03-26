import { describe, it, expect, vi } from "vitest";
import { WorkspaceBindingStore } from "./bindings.js";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function tmpPath(): string {
  const dir = join(
    tmpdir(),
    `bindings-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return join(dir, "bindings.json");
}

const sampleBinding = () => ({
  channelName: "project-alpha",
  workspace: "/home/user/projects/alpha",
  boundAt: new Date().toISOString(),
});

describe("WorkspaceBindingStore", () => {
  it("creates empty bindings when file does not exist", () => {
    const path = join(
      tmpdir(),
      `bindings-noexist-${Date.now()}`,
      "bindings.json",
    );
    const store = new WorkspaceBindingStore(path);
    expect(store.list()).toHaveLength(0);
  });

  it("loads existing bindings from file", () => {
    const path = tmpPath();
    const data = {
      "feishu:chat1": {
        channelName: "proj-a",
        workspace: "/ws/a",
        boundAt: "2026-01-01T00:00:00Z",
      },
    };
    writeFileSync(path, JSON.stringify(data), "utf-8");

    const store = new WorkspaceBindingStore(path);
    expect(store.get("feishu:chat1")).toEqual(data["feishu:chat1"]);
  });

  it("get returns undefined for unknown key", () => {
    const path = tmpPath();
    const store = new WorkspaceBindingStore(path);
    expect(store.get("nonexistent")).toBeUndefined();
  });

  it("set and get work correctly", () => {
    const path = tmpPath();
    const store = new WorkspaceBindingStore(path);
    const binding = sampleBinding();
    store.set("feishu:chat42", binding);
    expect(store.get("feishu:chat42")).toEqual(binding);
  });

  it("set overwrites existing binding", () => {
    const path = tmpPath();
    const store = new WorkspaceBindingStore(path);
    store.set("key", {
      channelName: "old",
      workspace: "/old",
      boundAt: "2026-01-01T00:00:00Z",
    });
    store.set("key", {
      channelName: "new",
      workspace: "/new",
      boundAt: "2026-02-01T00:00:00Z",
    });
    expect(store.get("key")?.channelName).toBe("new");
    expect(store.list()).toHaveLength(1);
  });

  it("remove deletes existing binding and returns true", () => {
    const path = tmpPath();
    const store = new WorkspaceBindingStore(path);
    store.set("k", sampleBinding());
    expect(store.remove("k")).toBe(true);
    expect(store.get("k")).toBeUndefined();
    expect(store.list()).toHaveLength(0);
  });

  it("remove returns false for unknown key", () => {
    const path = tmpPath();
    const store = new WorkspaceBindingStore(path);
    expect(store.remove("nope")).toBe(false);
  });

  it("list returns all bindings with channelKey", () => {
    const path = tmpPath();
    const store = new WorkspaceBindingStore(path);
    store.set("feishu:a", {
      channelName: "a",
      workspace: "/a",
      boundAt: "2026-01-01T00:00:00Z",
    });
    store.set("slack:b", {
      channelName: "b",
      workspace: "/b",
      boundAt: "2026-01-02T00:00:00Z",
    });

    const items = store.list();
    expect(items).toHaveLength(2);
    const keys = items.map((i) => i.channelKey).sort();
    expect(keys).toEqual(["feishu:a", "slack:b"]);
    // each item should have the binding fields
    for (const item of items) {
      expect(item).toHaveProperty("channelName");
      expect(item).toHaveProperty("workspace");
      expect(item).toHaveProperty("boundAt");
    }
  });

  it("findByWorkspace finds the correct binding", () => {
    const path = tmpPath();
    const store = new WorkspaceBindingStore(path);
    store.set("feishu:x", {
      channelName: "x",
      workspace: "/ws/x",
      boundAt: "2026-01-01T00:00:00Z",
    });
    store.set("feishu:y", {
      channelName: "y",
      workspace: "/ws/y",
      boundAt: "2026-01-01T00:00:00Z",
    });

    const result = store.findByWorkspace("/ws/y");
    expect(result).toBeDefined();
    expect(result!.channelKey).toBe("feishu:y");
    expect(result!.binding.channelName).toBe("y");
  });

  it("findByWorkspace returns undefined when no match", () => {
    const path = tmpPath();
    const store = new WorkspaceBindingStore(path);
    store.set("k", sampleBinding());
    expect(store.findByWorkspace("/nonexistent")).toBeUndefined();
  });

  it("resolveByConvention returns path when directory exists", () => {
    const base = join(
      tmpdir(),
      `resolve-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const channelDir = join(base, "my-channel");
    mkdirSync(channelDir, { recursive: true });

    const result = WorkspaceBindingStore.resolveByConvention(
      base,
      "my-channel",
    );
    expect(result).toBe(channelDir);

    // cleanup
    rmSync(base, { recursive: true, force: true });
  });

  it("resolveByConvention returns null when directory does not exist", () => {
    const result = WorkspaceBindingStore.resolveByConvention(
      "/tmp/nonexistent-base-dir",
      "no-such-channel",
    );
    expect(result).toBeNull();
  });

  it("flush writes to disk immediately", () => {
    const path = tmpPath();
    const store = new WorkspaceBindingStore(path);
    store.set("ch1", {
      channelName: "chan1",
      workspace: "/ws/1",
      boundAt: "2026-03-01T00:00:00Z",
    });
    store.flush();

    expect(existsSync(path)).toBe(true);
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    expect(raw["ch1"]).toBeDefined();
    expect(raw["ch1"].channelName).toBe("chan1");
  });

  it("handles corrupt file gracefully", () => {
    const path = tmpPath();
    writeFileSync(path, "NOT VALID JSON {{{", "utf-8");

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = new WorkspaceBindingStore(path);
    expect(store.list()).toHaveLength(0);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("data persists across instances via flush", () => {
    const path = tmpPath();
    const store1 = new WorkspaceBindingStore(path);
    store1.set("feishu:persist", {
      channelName: "persist-test",
      workspace: "/ws/persist",
      boundAt: "2026-06-01T00:00:00Z",
    });
    store1.flush();

    const store2 = new WorkspaceBindingStore(path);
    expect(store2.get("feishu:persist")?.workspace).toBe("/ws/persist");
  });
});
