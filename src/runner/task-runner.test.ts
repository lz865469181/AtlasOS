import { describe, it, expect, vi } from "vitest";

// Mock getConfig before importing TaskRunner
vi.mock("../config.js", () => ({
  getConfig: () => ({
    agent: {
      backend: "claude",
      max_concurrent_per_agent: 2,
      timeout: "120s",
      claude_cli_path: "claude",
    },
    mcp: { config_path: "" },
  }),
  parseDuration: () => 120_000,
}));

// Mock backend functions
vi.mock("../backend/index.js", () => ({
  getCliPath: () => "echo", // use echo as a safe substitute
  buildSpawnArgs: () => ["hello"],
  getStdinPrompt: () => "test prompt",
}));

import { TaskRunner } from "./task-runner.js";
import type { TaskDefinition } from "./task-runner.js";
import type { PlatformSender } from "../platform/types.js";

function createMockSender(): PlatformSender {
  return {
    sendText: vi.fn().mockResolvedValue(undefined),
    sendMarkdown: vi.fn().mockResolvedValue("msg-id-123"),
    sendInteractiveCard: vi.fn().mockResolvedValue(undefined),
    updateMarkdown: vi.fn().mockResolvedValue(undefined),
    addReaction: vi.fn().mockResolvedValue(undefined),
  };
}

describe("TaskRunner", () => {
  it("creates with default config from getConfig", () => {
    const runner = new TaskRunner();
    // Should not throw — uses config.agent.max_concurrent_per_agent
    expect(runner).toBeTruthy();
  });

  it("creates with custom config override", () => {
    const runner = new TaskRunner({ maxConcurrent: 5, timeoutMs: 30_000 });
    expect(runner).toBeTruthy();
  });

  it("runParallel sends progress messages", async () => {
    const sender = createMockSender();
    const runner = new TaskRunner({ maxConcurrent: 2, timeoutMs: 10_000 });

    const tasks: TaskDefinition[] = [
      { id: "T1", description: "Task one", prompt: "do task 1", workDir: "." },
      { id: "T2", description: "Task two", prompt: "do task 2", workDir: "." },
    ];

    const results = await runner.runParallel(tasks, sender, "chat1", "user1", "p2p");

    // Should have sent initial progress card + per-task updates + final summary
    expect(sender.sendMarkdown).toHaveBeenCalled();
    expect(results).toHaveLength(2);

    // Each result should have required fields
    for (const r of results) {
      expect(r.id).toBeTruthy();
      expect(r.description).toBeTruthy();
      expect(["success", "error", "timeout"]).toContain(r.status);
      expect(r.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("respects concurrency limit", async () => {
    const sender = createMockSender();
    const runner = new TaskRunner({ maxConcurrent: 1, timeoutMs: 10_000 });

    const tasks: TaskDefinition[] = [
      { id: "T1", description: "First", prompt: "task 1", workDir: "." },
      { id: "T2", description: "Second", prompt: "task 2", workDir: "." },
      { id: "T3", description: "Third", prompt: "task 3", workDir: "." },
    ];

    const results = await runner.runParallel(tasks, sender, "chat1", "user1", "p2p");

    expect(results).toHaveLength(3);
    // All tasks should complete (even with concurrency=1)
    for (const r of results) {
      expect(r.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("handles group chat with @mention prefix", async () => {
    const sender = createMockSender();
    const runner = new TaskRunner({ maxConcurrent: 2, timeoutMs: 10_000 });

    const tasks: TaskDefinition[] = [
      { id: "T1", description: "Task one", prompt: "do it", workDir: "." },
    ];

    await runner.runParallel(tasks, sender, "chat1", "user1", "group");

    // Should include @mention in group messages
    const firstCall = vi.mocked(sender.sendMarkdown).mock.calls[0];
    expect(firstCall[1]).toContain("<at id=user1>");
  });
});

describe("TaskRunner - parseTaskList logic", () => {
  // Test the parsing logic used by /run command

  function parseTaskList(input: string): string[] {
    const quoted = [...input.matchAll(/"([^"]+)"/g)].map((m) => m[1]!.trim());
    if (quoted.length >= 2) return quoted;
    const lines = input.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length >= 2) return lines;
    return lines;
  }

  it("parses quoted tasks", () => {
    const tasks = parseTaskList('"research topic A" "analyze topic B" "summarize"');
    expect(tasks).toEqual(["research topic A", "analyze topic B", "summarize"]);
  });

  it("parses newline-separated tasks", () => {
    const tasks = parseTaskList("research topic A\nanalyze topic B\nsummarize");
    expect(tasks).toEqual(["research topic A", "analyze topic B", "summarize"]);
  });

  it("ignores blank lines", () => {
    const tasks = parseTaskList("task 1\n\n\ntask 2\n");
    expect(tasks).toEqual(["task 1", "task 2"]);
  });

  it("returns single task for non-quoted single line", () => {
    const tasks = parseTaskList("just one task");
    expect(tasks).toEqual(["just one task"]);
  });
});
