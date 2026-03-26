# beam-flow Session Bridging Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users start a Claude CLI session locally with `beam-flow start`, "park" it, then list and resume it from Feishu via `/sessions` and `/resume`.

**Architecture:** A thin CLI (`src/cli/beam-flow.ts`) spawns Claude and tracks the session via env vars. `beam-flow park` POSTs to the already-running server. The Engine gains parked session storage (via SessionManager persistence) and two new slash commands (`/sessions`, `/resume`) that resume parked sessions using `--session-id`.

**Tech Stack:** TypeScript, Node.js child_process, Express REST endpoints, Feishu interactive cards

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/cli/beam-flow.ts` | Create | CLI entry point: start, park, sessions, drop |
| `src/core/session/parked.ts` | Create | ParkedSession type + CRUD store with disk persistence |
| `src/core/command/builtins.ts` | Create | /sessions and /resume slash command handlers |
| `src/core/engine.ts` | Modify | Expose parked store, add resumeParkedSession(), capture cliSessionId |
| `src/webui/server.ts` | Modify | Add /api/beam/* endpoints, CSRF exemption |
| `src/index.ts` | Modify | Wire persistPath, register builtin commands, pass parked store to WebUI |
| `package.json` | Modify | Add bin.beam-flow entry |

---

## Chunk 1: Parked Session Store

### Task 1: ParkedSession data model and store

**Files:**
- Create: `src/core/session/parked.ts`
- Test: `src/core/session/parked.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/core/session/parked.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ParkedSessionStore } from "./parked.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
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
    const store = new ParkedSessionStore("/nonexistent/parked.json");
    expect(() => store.loadFromDisk()).not.toThrow();
    expect(store.list()).toHaveLength(0);
  });

  it("lists sorted by parkedAt descending (most recent first)", () => {
    const store = new ParkedSessionStore();
    store.park({ name: "old", cliSessionId: "a", parkedAt: 100 });
    store.park({ name: "new", cliSessionId: "b", parkedAt: 300 });
    store.park({ name: "mid", cliSessionId: "c", parkedAt: 200 });
    const names = store.list().map((s) => s.name);
    expect(names).toEqual(["new", "mid", "old"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/session/parked.test.ts`
Expected: FAIL — cannot resolve `./parked.js`

- [ ] **Step 3: Implement ParkedSessionStore**

```typescript
// src/core/session/parked.ts
import { readFileSync, writeFileSync } from "node:fs";

export interface ParkedSession {
  name: string;
  cliSessionId: string;
  parkedAt: number;
  parkedBy?: string;
}

export class ParkedSessionStore {
  private sessions = new Map<string, ParkedSession>();
  private persistPath: string | null;

  constructor(persistPath?: string) {
    this.persistPath = persistPath ?? null;
  }

  park(session: ParkedSession): void {
    this.sessions.set(session.name, session);
  }

  get(name: string): ParkedSession | undefined {
    return this.sessions.get(name);
  }

  remove(name: string): boolean {
    return this.sessions.delete(name);
  }

  list(): ParkedSession[] {
    return [...this.sessions.values()].sort((a, b) => b.parkedAt - a.parkedAt);
  }

  loadFromDisk(): void {
    if (!this.persistPath) return;
    try {
      const raw = readFileSync(this.persistPath, "utf-8");
      const data = JSON.parse(raw) as ParkedSession[];
      for (const s of data) {
        if (s && s.name && s.cliSessionId) {
          this.sessions.set(s.name, s);
        }
      }
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        // Silently ignore parse errors on corrupt files
      }
    }
  }

  saveToDisk(): void {
    if (!this.persistPath) return;
    try {
      writeFileSync(this.persistPath, JSON.stringify(this.list(), null, 2), "utf-8");
    } catch {
      // Best-effort persistence
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/session/parked.test.ts`
Expected: 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/session/parked.ts src/core/session/parked.test.ts
git commit -m "feat(beam-flow): add ParkedSessionStore with persistence"
```

---

## Chunk 2: Engine Integration

### Task 2: Wire parked store into Engine and capture cliSessionId

**Files:**
- Modify: `src/core/engine.ts`
- Modify: `src/core/engine.test.ts`

**Context:** The Engine currently:
- Uses `this.states` (raw Map) for InteractiveState — line 34
- Creates sessions with `{ workDir: process.cwd(), continueSession: true }` — line 133-135
- Handles `result` events at line 200 but ignores `ev.sessionId` (available via `AgentEvent.sessionId` on result type)
- SessionManager is constructed without `persistPath` — line 41

Changes needed:
1. Add `persistPath` to EngineConfig
2. Pass it to SessionManager constructor
3. Create and expose `ParkedSessionStore`
4. On `result` event, capture `ev.sessionId` if present
5. Add `resumeParkedSession()` method

- [ ] **Step 1: Write the failing tests**

Add to `src/core/engine.test.ts`:

```typescript
// Add these tests at the end of the describe("Engine") block:

it("exposes parkedSessions store", () => {
  const agent = createMockAgent();
  const engine = new Engine(agent, {
    project: "test",
    dataDir: "/tmp/test",
    sessionTtlMs: 3600_000,
  });
  expect(engine.parkedSessions).toBeDefined();
  expect(engine.parkedSessions.list()).toEqual([]);
});

it("resumes a parked session with sessionId", async () => {
  const agent = createMockAgent([{ type: "result", content: "resumed!" }]);
  const engine = new Engine(agent, {
    project: "test",
    dataDir: "/tmp/test",
    sessionTtlMs: 3600_000,
  });
  const sender = createMockSender();
  const platform = createMockPlatform();

  // Park a session
  engine.parkedSessions.park({
    name: "my-task",
    cliSessionId: "real-claude-id-123",
    parkedAt: Date.now(),
  });

  // Resume it
  const event = createMessageEvent({ text: "/resume my-task" });
  // Register resume command manually for this test
  engine.commands.register({
    name: "resume",
    description: "Resume parked session",
    handler: async (ctx) => {
      const name = ctx.args.trim();
      const parked = engine.parkedSessions.get(name);
      if (!parked) {
        await ctx.reply(`Session '${name}' not found`);
        return;
      }
      await ctx.reply(`Resuming '${name}'...`);
    },
  });

  await engine.handleMessage(event, sender, platform);
  const textCalls = (sender.sendText as any).mock.calls;
  expect(textCalls.some((c: any[]) => c[1].includes("Resuming"))).toBe(true);
  await engine.stop();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/engine.test.ts`
Expected: FAIL — `engine.parkedSessions` does not exist

- [ ] **Step 3: Modify Engine**

In `src/core/engine.ts`:

1. Add import at top:
```typescript
import { ParkedSessionStore } from "./session/parked.js";
```

2. Add to `EngineConfig`:
```typescript
export interface EngineConfig {
  project: string;
  dataDir: string;
  sessionTtlMs: number;
  persistPath?: string;  // ADD THIS
  streamPreview?: { intervalMs?: number; minDeltaChars?: number; maxChars?: number };
}
```

3. Add public field to Engine class:
```typescript
readonly parkedSessions: ParkedSessionStore;
```

4. In constructor, after `this.dedup = new MessageDedup()`:
```typescript
// Wire persistence
const parkedPath = config.persistPath
  ? config.persistPath.replace(/sessions\.json$/, "parked.json")
  : undefined;
this.parkedSessions = new ParkedSessionStore(parkedPath);
this.parkedSessions.loadFromDisk();

if (config.persistPath) {
  this.sessions = new SessionManager(config.sessionTtlMs, config.persistPath);
  this.sessions.loadFromDisk();
}
```

5. In `processMessage`, after the `case "result"` block (line 200-210), capture sessionId:
```typescript
case "result": {
  // Capture CLI session ID for future bridging
  if (ev.sessionId) {
    const meta = this.sessions.get(sessionKey);
    if (meta) {
      meta.cliSessionId = ev.sessionId;
    }
  }
  // ... rest of existing code
}
```

6. In `stop()`, save parked sessions:
```typescript
async stop(): Promise<void> {
  // ... existing code ...
  this.parkedSessions.saveToDisk();
  // ... rest
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/engine.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/engine.ts src/core/engine.test.ts
git commit -m "feat(beam-flow): wire ParkedSessionStore into Engine"
```

---

### Task 3: Builtin slash commands (/sessions, /resume)

**Files:**
- Create: `src/core/command/builtins.ts`
- Test: `src/core/command/builtins.test.ts`

**Context:** Commands are registered via `engine.commands.register({ name, description, handler })`. The handler receives `CommandContext` with `args`, `userID`, `reply(text)`, and `replyCard(json)`. See `src/core/command/registry.ts:3-11` for the interface.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/core/command/builtins.test.ts
import { describe, it, expect, vi } from "vitest";
import { createSessionsCommand, createResumeCommand } from "./builtins.js";
import { ParkedSessionStore } from "../session/parked.js";
import type { CommandContext } from "./registry.js";

function mockCtx(args = ""): CommandContext & { replies: string[]; cards: string[] } {
  const replies: string[] = [];
  const cards: string[] = [];
  return {
    args,
    userID: "user-1",
    chatID: "chat-1",
    chatType: "p2p" as const,
    platform: "feishu",
    reply: vi.fn(async (text: string) => { replies.push(text); }),
    replyCard: vi.fn(async (json: string) => { cards.push(json); }),
    replies,
    cards,
  };
}

describe("/sessions command", () => {
  it("replies with empty message when no parked sessions", async () => {
    const store = new ParkedSessionStore();
    const cmd = createSessionsCommand(store);
    const ctx = mockCtx();
    await cmd.handler(ctx);
    expect(ctx.replies.length + ctx.cards.length).toBeGreaterThan(0);
    const all = [...ctx.replies, ...ctx.cards].join(" ");
    expect(all).toContain("No parked sessions");
  });

  it("lists parked sessions", async () => {
    const store = new ParkedSessionStore();
    store.park({ name: "fix-bug", cliSessionId: "id1", parkedAt: Date.now() - 60_000 });
    store.park({ name: "refactor", cliSessionId: "id2", parkedAt: Date.now() });
    const cmd = createSessionsCommand(store);
    const ctx = mockCtx();
    await cmd.handler(ctx);
    const all = [...ctx.replies, ...ctx.cards].join(" ");
    expect(all).toContain("fix-bug");
    expect(all).toContain("refactor");
  });
});

describe("/resume command", () => {
  it("replies with error when no name given", async () => {
    const store = new ParkedSessionStore();
    const resumeFn = vi.fn();
    const cmd = createResumeCommand(store, resumeFn);
    const ctx = mockCtx("");
    await cmd.handler(ctx);
    expect(ctx.replies[0]).toContain("Usage");
  });

  it("replies with error when session not found", async () => {
    const store = new ParkedSessionStore();
    const resumeFn = vi.fn();
    const cmd = createResumeCommand(store, resumeFn);
    const ctx = mockCtx("nonexistent");
    await cmd.handler(ctx);
    expect(ctx.replies[0]).toContain("not found");
  });

  it("calls resumeFn and removes parked session on success", async () => {
    const store = new ParkedSessionStore();
    store.park({ name: "my-task", cliSessionId: "abc", parkedAt: Date.now() });
    const resumeFn = vi.fn().mockResolvedValue(undefined);
    const cmd = createResumeCommand(store, resumeFn);
    const ctx = mockCtx("my-task");
    await cmd.handler(ctx);
    expect(resumeFn).toHaveBeenCalledWith("abc", expect.objectContaining({ userID: "user-1" }));
    expect(store.get("my-task")).toBeUndefined();
    expect(ctx.replies.some((r) => r.includes("Resumed"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/command/builtins.test.ts`
Expected: FAIL — cannot resolve `./builtins.js`

- [ ] **Step 3: Implement builtins**

```typescript
// src/core/command/builtins.ts
import type { CommandDef, CommandContext } from "./registry.js";
import type { ParkedSessionStore } from "../session/parked.js";

function timeAgo(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function createSessionsCommand(store: ParkedSessionStore): CommandDef {
  return {
    name: "sessions",
    description: "List parked CLI sessions available for resume",
    aliases: ["ss"],
    handler: async (ctx: CommandContext) => {
      const sessions = store.list();
      if (sessions.length === 0) {
        await ctx.reply("No parked sessions. Use `beam-flow park` from your terminal to park a session.");
        return;
      }

      const lines = sessions.map((s, i) => {
        const ago = timeAgo(Date.now() - s.parkedAt);
        return `${i + 1}. **${s.name}** (${ago})`;
      });

      const text = `**Parked Sessions**\n\n${lines.join("\n")}\n\nTo resume: \`/resume <name>\``;
      await ctx.reply(text);
    },
  };
}

export type ResumeFn = (cliSessionId: string, ctx: { userID: string; chatID: string; chatType: string; platform: string }) => Promise<void>;

export function createResumeCommand(store: ParkedSessionStore, resumeFn: ResumeFn): CommandDef {
  return {
    name: "resume",
    description: "Resume a parked CLI session",
    aliases: ["rs"],
    handler: async (ctx: CommandContext) => {
      const name = ctx.args.trim();
      if (!name) {
        await ctx.reply("Usage: `/resume <session-name>`");
        return;
      }

      const parked = store.get(name);
      if (!parked) {
        await ctx.reply(`Session '${name}' not found. Use \`/sessions\` to list available sessions.`);
        return;
      }

      try {
        await resumeFn(parked.cliSessionId, {
          userID: ctx.userID,
          chatID: ctx.chatID,
          chatType: ctx.chatType,
          platform: ctx.platform,
        });
        store.remove(name);
        store.saveToDisk();
        await ctx.reply(`Resumed session '${name}'! Claude remembers your conversation.`);
      } catch (err) {
        await ctx.reply(`Failed to resume '${name}': ${err}`);
      }
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/command/builtins.test.ts`
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/command/builtins.ts src/core/command/builtins.test.ts
git commit -m "feat(beam-flow): add /sessions and /resume slash commands"
```

---

## Chunk 3: Server API + CLI Tool

### Task 4: WebUI beam API endpoints

**Files:**
- Modify: `src/webui/server.ts`
- Modify: `src/index.ts`

**Context:** The WebUI server is at `src/webui/server.ts`. It already has CSRF exemptions for `/api/reuse` routes (line 52-56). The `WebUIDeps` interface (line 114) currently only has `workspace?`. We need to add the parked store reference and the Engine reference (for resume).

- [ ] **Step 1: Add parked store to WebUIDeps**

In `src/webui/server.ts`, modify `WebUIDeps`:

```typescript
export interface WebUIDeps {
  workspace?: Workspace;
  parkedSessions?: import("../core/session/parked.js").ParkedSessionStore;
}
```

- [ ] **Step 2: Add CSRF exemption for /api/beam routes**

In `csrfMiddleware` (line 53), update the check:

```typescript
const isExempt = req.path.startsWith("/api/reuse")
  || req.path.startsWith("/api/beam");
if (!isExempt) {
  // ... existing CSRF check
}
```

- [ ] **Step 3: Add /api/beam endpoints**

Add before the `const server = app.listen(...)` line (before line 364):

```typescript
// ─── beam-flow session bridging ─────────────────────────────────────────
app.post("/api/beam/park", (req, res) => {
  const store = deps?.parkedSessions;
  if (!store) {
    res.status(503).json({ error: "Parked session store not available" });
    return;
  }
  const { name, cliSessionId } = req.body;
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "name required" });
    return;
  }
  if (!cliSessionId || typeof cliSessionId !== "string") {
    res.status(400).json({ error: "cliSessionId required" });
    return;
  }
  store.park({ name, cliSessionId, parkedAt: Date.now() });
  store.saveToDisk();
  res.json({ ok: true, name, cliSessionId });
});

app.get("/api/beam/sessions", (_req, res) => {
  const store = deps?.parkedSessions;
  if (!store) {
    res.status(503).json({ error: "Parked session store not available" });
    return;
  }
  res.json(store.list());
});

app.delete("/api/beam/sessions/:name", (req, res) => {
  const store = deps?.parkedSessions;
  if (!store) {
    res.status(503).json({ error: "Parked session store not available" });
    return;
  }
  const removed = store.remove(req.params.name);
  if (removed) store.saveToDisk();
  res.json({ ok: removed });
});
```

- [ ] **Step 4: Wire everything in src/index.ts**

In `src/index.ts`, make these changes:

1. Add imports:
```typescript
import { createSessionsCommand, createResumeCommand } from "./core/command/builtins.js";
```

2. After `const engine = new Engine(agent, { ... })` (around line 55), update the config to include `persistPath`:
```typescript
const engine = new Engine(agent, {
  project: agentID,
  dataDir: workspace.agentDir,
  sessionTtlMs,
  persistPath: join(workspace.agentDir, "sessions.json"),
});
```

3. After Engine creation, register builtin commands:
```typescript
// Register builtin commands
engine.commands.register(createSessionsCommand(engine.parkedSessions));
engine.commands.register(createResumeCommand(engine.parkedSessions, async (cliSessionId, ctx) => {
  // Create a new InteractiveState using the parked session's CLI session ID
  const sessionKey = `${agentID}:${ctx.userID}`;
  const agentSession = await agent.startSession({
    workDir: process.cwd(),
    sessionId: cliSessionId,
  });
  // The Engine will pick up this session on next handleMessage
  // For now, just confirm — the next message from this user will use the resumed session
  log("info", "Resumed parked session", { cliSessionId, userID: ctx.userID });
}));
```

4. Pass parked store to WebUI:
```typescript
webuiServer = startWebUI(config.webui.port, {
  workspace,
  parkedSessions: engine.parkedSessions,
});
```

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS (existing + new)

- [ ] **Step 6: Commit**

```bash
git add src/webui/server.ts src/index.ts
git commit -m "feat(beam-flow): add /api/beam endpoints and wire Engine persistence"
```

---

### Task 5: CLI tool (beam-flow)

**Files:**
- Create: `src/cli/beam-flow.ts`
- Modify: `package.json`

**Context:** This is a standalone CLI script that users run in their terminal. It spawns Claude CLI interactively and communicates with the feishu-ai-assistant server via HTTP.

- [ ] **Step 1: Create the CLI script**

```typescript
// src/cli/beam-flow.ts
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";

const SERVER_URL = process.env.BEAM_SERVER_URL ?? "http://127.0.0.1:20263";

async function httpJSON(method: string, path: string, body?: unknown): Promise<any> {
  const url = `${SERVER_URL}${path}`;
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(url, opts);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`${resp.status}: ${text}`);
  }
  return resp.json();
}

function printExport(key: string, value: string): void {
  // Detect shell and print appropriate export command
  const shell = process.env.SHELL ?? process.env.ComSpec ?? "";
  if (shell.includes("powershell") || shell.includes("pwsh") || process.platform === "win32") {
    console.log(`  $env:${key}="${value}"`);
  } else {
    console.log(`  export ${key}="${value}"`);
  }
}

async function cmdStart(name: string): Promise<void> {
  if (!name) {
    console.error("Usage: beam-flow start <session-name>");
    process.exit(1);
  }

  const sessionId = randomUUID();
  console.log(`Starting Claude session '${name}' (id: ${sessionId})`);
  console.log("To set env vars in your shell after exit, run:");
  printExport("BEAM_SESSION_ID", sessionId);
  printExport("BEAM_SESSION_NAME", name);
  console.log("");

  const cliPath = process.env.CLAUDE_CLI_PATH ?? "claude";

  const child = spawn(cliPath, ["--session-id", sessionId], {
    stdio: "inherit",
    env: {
      ...process.env,
      BEAM_SESSION_ID: sessionId,
      BEAM_SESSION_NAME: name,
    },
  });

  const code = await new Promise<number>((resolve) => {
    child.on("close", (c) => resolve(c ?? 0));
  });

  console.log(`\nClaude exited (code ${code}).`);
  console.log(`Session '${name}' ready to park. Run: beam-flow park`);
  console.log(`Or park now automatically? [Y/n] `);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question("", (a) => { rl.close(); resolve(a.trim()); });
  });

  if (!answer || answer.toLowerCase() === "y" || answer.toLowerCase() === "yes") {
    await doPark(name, sessionId);
  }
}

async function doPark(name: string, sessionId: string): Promise<void> {
  try {
    await httpJSON("POST", "/api/beam/park", { name, cliSessionId: sessionId });
    console.log(`Parked '${name}'! In Feishu, type: /sessions`);
  } catch (err) {
    console.error(`Failed to park: ${err}`);
    console.error("Is the feishu-ai-assistant server running?");
    process.exit(1);
  }
}

async function cmdPark(name?: string): Promise<void> {
  const sessionId = process.env.BEAM_SESSION_ID;
  const sessionName = name ?? process.env.BEAM_SESSION_NAME;

  if (sessionId && sessionName) {
    await doPark(sessionName, sessionId);
    return;
  }

  // Fallback: ask server for recent sessions or prompt user
  if (!sessionName) {
    console.error("No BEAM_SESSION_NAME found in environment.");
    console.error("Usage: beam-flow park <name>");
    console.error("Or run beam-flow start <name> first to set up env vars.");
    process.exit(1);
  }

  if (!sessionId) {
    console.error("No BEAM_SESSION_ID found in environment.");
    console.error("Run beam-flow start <name> first.");
    process.exit(1);
  }
}

async function cmdSessions(): Promise<void> {
  try {
    const sessions = await httpJSON("GET", "/api/beam/sessions");
    if (!sessions.length) {
      console.log("No parked sessions.");
      return;
    }
    console.log("Parked sessions:\n");
    for (const s of sessions) {
      const ago = timeAgo(Date.now() - s.parkedAt);
      console.log(`  ${s.name}  (${ago})  [${s.cliSessionId.slice(0, 8)}...]`);
    }
    console.log(`\nResume in Feishu: /resume <name>`);
  } catch (err) {
    console.error(`Failed to list sessions: ${err}`);
    process.exit(1);
  }
}

async function cmdDrop(name: string): Promise<void> {
  if (!name) {
    console.error("Usage: beam-flow drop <session-name>");
    process.exit(1);
  }
  try {
    const result = await httpJSON("DELETE", `/api/beam/sessions/${encodeURIComponent(name)}`);
    if (result.ok) {
      console.log(`Dropped session '${name}'.`);
    } else {
      console.log(`Session '${name}' not found.`);
    }
  } catch (err) {
    console.error(`Failed to drop: ${err}`);
    process.exit(1);
  }
}

function timeAgo(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ─── CLI Entry ──────────────────────────────────────────────────────────────

const [,, cmd, ...args] = process.argv;

switch (cmd) {
  case "start":
    await cmdStart(args.join(" "));
    break;
  case "park":
    await cmdPark(args.join(" ") || undefined);
    break;
  case "sessions":
  case "ls":
    await cmdSessions();
    break;
  case "drop":
  case "rm":
    await cmdDrop(args.join(" "));
    break;
  default:
    console.log(`beam-flow - Teleport your Claude sessions to Feishu

Usage:
  beam-flow start <name>     Start Claude CLI with session tracking
  beam-flow park [name]      Park current session for Feishu
  beam-flow sessions         List parked sessions
  beam-flow drop <name>      Remove a parked session

Environment:
  BEAM_SERVER_URL            Server URL (default: http://127.0.0.1:20263)
  CLAUDE_CLI_PATH            Path to claude CLI (default: claude)
`);
    break;
}
```

- [ ] **Step 2: Add bin entry to package.json**

Add to `package.json`:

```json
{
  "bin": {
    "beam-flow": "dist/cli/beam-flow.js"
  }
}
```

Also add to `scripts`:
```json
{
  "beam": "tsx src/cli/beam-flow.ts"
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Test CLI manually**

Run: `npx tsx src/cli/beam-flow.ts`
Expected: Shows help text

Run: `npx tsx src/cli/beam-flow.ts sessions`
Expected: Either shows "No parked sessions" or errors with "server not running" (both correct)

- [ ] **Step 5: Commit**

```bash
git add src/cli/beam-flow.ts package.json
git commit -m "feat(beam-flow): add CLI tool with start/park/sessions/drop"
```

---

## Chunk 4: Integration and Final Wiring

### Task 6: Engine resumeSession method

**Files:**
- Modify: `src/core/engine.ts`

**Context:** Currently the resume logic is inlined in `src/index.ts` as a callback. For proper testability and to handle the InteractiveState correctly, we need a `resumeSession` method on Engine that creates the InteractiveState with the given `sessionId`.

- [ ] **Step 1: Add resumeSession to Engine**

In `src/core/engine.ts`, add method after `processMessage`:

```typescript
async resumeSession(
  cliSessionId: string,
  replyCtx: ReplyContext,
): Promise<void> {
  const sessionKey = `${this.project}:${replyCtx.userID}`;

  // Close existing session if any
  const existing = this.states.get(sessionKey);
  if (existing) {
    await existing.agentSession.close().catch(() => {});
  }

  // Start new session with the parked session's CLI ID
  const agentSession = await this.agent.startSession({
    workDir: process.cwd(),
    sessionId: cliSessionId,
  });

  const state: InteractiveState = {
    sessionKey,
    agentSession,
    replyCtx,
    pendingMessages: [],
    approveAll: false,
    quiet: false,
    lastActivity: Date.now(),
  };
  this.states.set(sessionKey, state);
  log("info", "Resumed parked session", { sessionKey, cliSessionId });
}
```

- [ ] **Step 2: Update index.ts resume callback**

In `src/index.ts`, simplify the resume command registration:

```typescript
engine.commands.register(createResumeCommand(engine.parkedSessions, async (cliSessionId, ctx) => {
  await engine.resumeSession(cliSessionId, {
    platform: ctx.platform,
    chatID: ctx.chatID,
    chatType: ctx.chatType as "p2p" | "group",
    userID: ctx.userID,
    messageID: `resume-${Date.now()}`,
  });
}));
```

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 4: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/core/engine.ts src/index.ts
git commit -m "feat(beam-flow): add Engine.resumeSession for parked session resume"
```

---

### Task 7: Full integration test

**Files:**
- Modify: `src/core/engine.test.ts`

- [ ] **Step 1: Add integration test**

Add to `src/core/engine.test.ts`:

```typescript
it("full beam-flow cycle: park → list → resume", async () => {
  const agent = createMockAgent([{ type: "result", content: "I remember!" }]);
  const engine = new Engine(agent, {
    project: "test",
    dataDir: "/tmp/test",
    sessionTtlMs: 3600_000,
  });

  // 1. Park a session
  engine.parkedSessions.park({
    name: "debug-issue",
    cliSessionId: "real-session-uuid-456",
    parkedAt: Date.now(),
  });

  // 2. List should show it
  expect(engine.parkedSessions.list()).toHaveLength(1);
  expect(engine.parkedSessions.get("debug-issue")?.cliSessionId).toBe("real-session-uuid-456");

  // 3. Resume
  const sender = createMockSender();
  await engine.resumeSession("real-session-uuid-456", {
    platform: "feishu",
    chatID: "chat-1",
    chatType: "p2p",
    userID: "user-1",
    messageID: "msg-resume",
  });

  // 4. Verify agent was called with sessionId
  expect(agent.startSession).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: "real-session-uuid-456" }),
  );

  // 5. Remove from parked
  engine.parkedSessions.remove("debug-issue");
  expect(engine.parkedSessions.list()).toHaveLength(0);

  await engine.stop();
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/core/engine.test.ts
git commit -m "test(beam-flow): add full park/list/resume integration test"
```

---

### Task 8: Final cleanup and full verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: Zero errors

- [ ] **Step 3: Verify CLI tool works**

Run: `npx tsx src/cli/beam-flow.ts`
Expected: Help text displayed

- [ ] **Step 4: Final commit if any fixups needed**

```bash
git add -A
git commit -m "chore(beam-flow): final cleanup"
```
