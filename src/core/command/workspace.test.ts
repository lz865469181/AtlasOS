import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWorkspaceCommand } from "./builtins.js";
import type { CommandContext } from "./registry.js";
import type { Engine } from "../engine.js";
import type { WorkspaceBindingStore, WorkspaceBinding } from "../workspace/bindings.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function mockCtx(
  args = "",
  overrides: Partial<CommandContext> = {},
): CommandContext & { replies: string[] } {
  const replies: string[] = [];
  return {
    args,
    userID: "user-1",
    chatID: "chat-1",
    chatType: "p2p" as const,
    platform: "feishu",
    reply: vi.fn(async (text: string) => {
      replies.push(text);
    }),
    replyCard: vi.fn(async () => {}),
    replies,
    ...overrides,
  };
}

type BindingsData = Record<string, WorkspaceBinding>;

function mockBindings(data: BindingsData = {}): WorkspaceBindingStore {
  const store: BindingsData = { ...data };
  return {
    get: (key: string) => store[key],
    set: (key: string, binding: WorkspaceBinding) => {
      store[key] = binding;
    },
    remove: (key: string) => {
      if (!(key in store)) return false;
      delete store[key];
      return true;
    },
    list: () =>
      Object.entries(store).map(([channelKey, b]) => ({
        channelKey,
        ...b,
      })),
    findByWorkspace: () => undefined,
    flush: () => {},
  } as unknown as WorkspaceBindingStore;
}

function mockEngine(
  overrides: Partial<{
    isMultiWorkspace: boolean;
    workspaceBaseDir: string;
    bindings: WorkspaceBindingStore;
  }> = {},
): Engine {
  return {
    isMultiWorkspace: true,
    workspaceBaseDir: "/workspaces",
    bindings: mockBindings(),
    ...overrides,
  } as unknown as Engine;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("/workspace command", () => {
  describe("multi-workspace disabled", () => {
    it("replies with error when multi-workspace is not enabled", async () => {
      const engine = mockEngine({ isMultiWorkspace: false });
      const cmd = createWorkspaceCommand(engine);
      const ctx = mockCtx();
      await cmd.handler(ctx);
      expect(ctx.replies[0]).toContain("Multi-workspace mode is not enabled");
    });
  });

  describe("show current binding (no subcommand)", () => {
    it("shows 'no workspace' when channel has no binding", async () => {
      const engine = mockEngine();
      const cmd = createWorkspaceCommand(engine);
      const ctx = mockCtx("");
      await cmd.handler(ctx);
      expect(ctx.replies[0]).toContain("No workspace bound");
    });

    it("shows workspace path when channel is bound", async () => {
      const bindings = mockBindings({
        "feishu:chat-1": {
          channelName: "chat-1",
          workspace: "/workspaces/my-project",
          boundAt: "2026-01-01T00:00:00.000Z",
        },
      });
      const engine = mockEngine({ bindings });
      const cmd = createWorkspaceCommand(engine);
      const ctx = mockCtx("");
      await cmd.handler(ctx);
      expect(ctx.replies[0]).toContain("/workspaces/my-project");
      expect(ctx.replies[0]).toContain("2026-01-01");
    });
  });

  describe("bind subcommand", () => {
    it("replies with usage when no folder name given", async () => {
      const engine = mockEngine();
      const cmd = createWorkspaceCommand(engine);
      const ctx = mockCtx("bind");
      await cmd.handler(ctx);
      expect(ctx.replies[0]).toContain("Usage");
    });

    it("replies with error when directory does not exist", async () => {
      const engine = mockEngine({ workspaceBaseDir: "/workspaces" });
      const cmd = createWorkspaceCommand(engine);
      const ctx = mockCtx("bind nonexistent-dir");
      await cmd.handler(ctx);
      expect(ctx.replies[0]).toContain("Directory not found");
    });

    it("binds when directory exists", async () => {
      // Use a directory that actually exists on the system
      const cwd = process.cwd();
      const bindings = mockBindings();
      const engine = mockEngine({
        workspaceBaseDir: cwd,
        bindings,
      });
      const cmd = createWorkspaceCommand(engine);
      // "src" should exist in the project root
      const ctx = mockCtx("bind src");
      await cmd.handler(ctx);
      expect(ctx.replies[0]).toContain("Workspace bound:");
      // Verify the binding was actually set
      const binding = bindings.get("feishu:chat-1");
      expect(binding).toBeDefined();
      expect(binding!.workspace).toContain("src");
    });
  });

  describe("unbind subcommand", () => {
    it("removes binding and confirms", async () => {
      const bindings = mockBindings({
        "feishu:chat-1": {
          channelName: "chat-1",
          workspace: "/workspaces/project",
          boundAt: "2026-01-01T00:00:00.000Z",
        },
      });
      const engine = mockEngine({ bindings });
      const cmd = createWorkspaceCommand(engine);
      const ctx = mockCtx("unbind");
      await cmd.handler(ctx);
      expect(ctx.replies[0]).toBe("Workspace unbound.");
      expect(bindings.get("feishu:chat-1")).toBeUndefined();
    });

    it("replies when nothing to unbind", async () => {
      const engine = mockEngine();
      const cmd = createWorkspaceCommand(engine);
      const ctx = mockCtx("unbind");
      await cmd.handler(ctx);
      expect(ctx.replies[0]).toContain("No workspace was bound");
    });
  });

  describe("list subcommand", () => {
    it("shows all bindings", async () => {
      const bindings = mockBindings({
        "feishu:chat-1": {
          channelName: "chat-1",
          workspace: "/workspaces/alpha",
          boundAt: "2026-01-01T00:00:00.000Z",
        },
        "slack:channel-2": {
          channelName: "channel-2",
          workspace: "/workspaces/beta",
          boundAt: "2026-01-02T00:00:00.000Z",
        },
      });
      const engine = mockEngine({ bindings });
      const cmd = createWorkspaceCommand(engine);
      const ctx = mockCtx("list");
      await cmd.handler(ctx);
      expect(ctx.replies[0]).toContain("/workspaces/alpha");
      expect(ctx.replies[0]).toContain("/workspaces/beta");
      expect(ctx.replies[0]).toContain("feishu:chat-1");
    });

    it("shows message when no bindings exist", async () => {
      const engine = mockEngine();
      const cmd = createWorkspaceCommand(engine);
      const ctx = mockCtx("list");
      await cmd.handler(ctx);
      expect(ctx.replies[0]).toBe("No workspace bindings.");
    });
  });

  describe("unknown subcommand", () => {
    it("replies with usage hint", async () => {
      const engine = mockEngine();
      const cmd = createWorkspaceCommand(engine);
      const ctx = mockCtx("foobar");
      await cmd.handler(ctx);
      expect(ctx.replies[0]).toContain("Unknown subcommand: foobar");
    });
  });

  describe("command metadata", () => {
    it("has correct name and alias", () => {
      const engine = mockEngine();
      const cmd = createWorkspaceCommand(engine);
      expect(cmd.name).toBe("workspace");
      expect(cmd.aliases).toContain("ws");
    });
  });

  describe("init subcommand", () => {
    it("replies with usage when no URL given", async () => {
      const engine = mockEngine();
      const cmd = createWorkspaceCommand(engine);
      const ctx = mockCtx("init");
      await cmd.handler(ctx);
      expect(ctx.replies[0]).toContain("Usage");
    });

    it("rejects invalid URLs", async () => {
      const engine = mockEngine();
      const cmd = createWorkspaceCommand(engine);
      const ctx = mockCtx("init not-a-url!!!");
      await cmd.handler(ctx);
      expect(ctx.replies[0]).toContain("Invalid URL");
    });
  });
});
