# Feishu AI Assistant v2 — Architecture Design & Implementation Plan

> Based on DeerFlow capability gap analysis. Design principle: **Keep the lightweight CLI-bridge identity, don't rebuild DeerFlow.**

---

## Phase 1: Experience Fixes (P0)

### 1.1 Streaming Response Output

**Problem:** User sends a message → sees "THINKING" → silence for up to 2 min → full response.

**Current code:** `src/claude/client.ts` uses `execFile` (buffers all output), while `src/router/dev-agent.ts` already uses `spawn` + `stream-json` with incremental parsing.

**Design:**

```
┌──────────┐    spawn + stream-json     ┌──────────────┐
│  Router   │ ──────────────────────────→│  Claude CLI   │
│           │ ←─── stdout line-by-line ──│  subprocess   │
└────┬──────┘                            └──────────────┘
     │  on each assistant text chunk:
     │  ┌──────────────────────────┐
     │  │ 1st chunk: message.create│──→ Feishu (get messageID)
     │  │ 2nd+ chunk: message.patch│──→ Feishu (update same card)
     │  └──────────────────────────┘
```

**Changes:**

| File | Change |
|------|--------|
| `src/claude/client.ts` | New `askStreaming()` function using `spawn` + `stream-json`, returns `AsyncIterable<StreamChunk>` |
| `src/platform/types.ts` | Add `updateMarkdown(messageID, markdown)` to `PlatformSender` interface |
| `src/platform/feishu/client.ts` | Implement `updateMarkdown()` via `im.message.patch` API |
| `src/router/router.ts` | Use `askStreaming()`, accumulate chunks, throttled update (every 1s or 500 chars) |
| `src/backend/index.ts` | Add `askStreaming()` dispatch for both backends |

**Stream chunk types (from Claude CLI `stream-json`):**
```typescript
interface StreamChunk {
  type: "assistant" | "result" | "error" | "tool_use" | "tool_result";
  // assistant: partial text content
  // result: final result
  // error: error message
}
```

**Throttling strategy:** Buffer chunks, send update to Feishu at most once per second. On final `result` chunk, send the complete response. This avoids hitting Feishu API rate limits while keeping the user informed.

**Fallback:** If `stream-json` spawning fails, fall back to current `execFile` behavior (buffered).

---

### 1.2 Context Summarization

**Problem:** Context grows unbounded until CLI overflows, then session is brutally reset — losing all history.

**Current code:** `session.getConversationText(10)` replays last 10 messages as raw text. No token counting, no summarization.

**Design:**

```
                      Before each ask():
┌──────────┐     ┌─────────────────────────┐
│  Router   │────→│  ContextManager          │
│           │     │  1. count tokens (tiktoken│
│           │     │     or char-based est.)   │
│           │     │  2. if > threshold:       │
│           │     │     call LLM to summarize │
│           │     │     oldest N messages     │
│           │     │  3. replace in session    │
│           │     └─────────────────────────┘
```

**New module:** `src/context/manager.ts`

```typescript
export interface ContextManagerConfig {
  /** Max estimated tokens before triggering summarization. */
  maxTokens: number;           // default: 150_000 (80% of 200K)
  /** Number of recent messages to preserve (never summarized). */
  preserveRecent: number;      // default: 10
  /** Model to use for summarization (cheap/fast). */
  summaryModel: string;        // default: "claude-haiku-4-5-20251001"
}

export class ContextManager {
  /** Estimate token count for the session conversation. */
  estimateTokens(session: Session): number;

  /** Summarize old messages, replace them with a summary message in the session. */
  async maybeSummarize(session: Session): Promise<void>;
}
```

**Token estimation:** Use character count / 4 as rough estimate (no external dependency needed). Accurate enough for triggering thresholds.

**Summarization flow:**
1. Before each `ask()`, call `contextManager.maybeSummarize(session)`
2. If estimated tokens > `maxTokens`, take messages `[0..N-preserveRecent]`
3. Call Claude Haiku with: "Summarize this conversation, preserving key decisions, facts, and context"
4. Replace those messages with a single `{role: "assistant", content: "[Summary] ..."}` message
5. The summary is only stored in our session object — the CLI session continues natively

**Integration point:** `src/router/router.ts` line 62, before `sessionQueue.enqueue`.

---

### 1.3 Session Persistence

**Problem:** In-memory `Map<string, Session>` — process restart = all sessions lost.

**Current code:** `workspace/agents/default/sessions.json` is created but never read/written.

**Design:**

```
┌──────────────┐  save on change   ┌─────────────────┐
│SessionManager│──────────────────→│  sessions.json   │
│              │←──────────────────│  (per agent dir) │
│              │  load on startup  └─────────────────┘
```

**Changes:**

| File | Change |
|------|--------|
| `src/session/session.ts` | Add `toJSON()` and `static fromJSON()` serialization methods |
| `src/session/manager.ts` | Add `saveToDisk(path)` and `loadFromDisk(path)` methods; auto-save on session change (debounced 5s) |
| `src/index.ts` | Load sessions from disk on startup, pass workspace path to SessionManager |

**Serialization format** (`sessions.json`):
```json
{
  "default:ou_xxxx": {
    "id": "default:ou_xxxx",
    "agentID": "default",
    "userID": "ou_xxxx",
    "model": "claude-haiku-4-5-20251001",
    "cliSessionId": "uuid-here",
    "contextOverflowCount": 0,
    "conversation": [
      { "role": "user", "content": "...", "timestamp": 1711234567890 }
    ],
    "lastActiveAt": 1711234567890
  }
}
```

**Debounce:** Don't write to disk on every message. Use a 5-second debounce timer — if another change happens within 5s, reset the timer. This prevents thrashing on rapid conversations.

**Session restoration:** On startup, load all sessions. Discard sessions that exceed TTL (already expired). CLI session IDs (`cliSessionId`) will still be valid if Claude Code's own session store persists.

---

## Phase 2: Capability Expansion (P1)

### 2.1 MCP Integration

**Problem:** No external tool integration. All tools are whatever Claude CLI provides natively.

**Current code:** No MCP references anywhere.

**Design:** Leverage Claude CLI's native `--mcp-config` flag — **zero new code** for core integration.

```
config.json:
  "mcp": {
    "config_path": "./mcp-config.json"   // path to MCP config file
  }

mcp-config.json:
  {
    "mcpServers": {
      "feishu": {
        "command": "npx",
        "args": ["-y", "@anthropic/mcp-feishu"]
      },
      "jira": {
        "command": "npx",
        "args": ["-y", "@anthropic/mcp-jira"]
      }
    }
  }
```

**Changes:**

| File | Change |
|------|--------|
| `src/claude/client.ts` | Add `--mcp-config <path>` to CLI args when config.mcp.config_path exists |
| `src/backend/index.ts` | Pass `mcpConfigPath` through `buildSpawnArgs()` |
| `config.json` | Add `mcp` section |
| Root | Add `mcp-config.json` template |

**Why this works:** Claude CLI already has full MCP support. We just need to tell it where the config is. The CLI handles server lifecycle, tool discovery, and execution. No need to reimplement DeerFlow's MCP client.

**Dev agent:** Also passes `--mcp-config` so autonomous dev tasks can use external tools.

---

### 2.2 Active Memory System

**Problem:** `MEMORY.md` files exist but the app never writes to them. Memory depends entirely on Claude CLI's autonomous file editing.

**Current code:** `context-builder.ts` reads `MEMORY.md` but nothing writes to it.

**Design:**

```
┌──────────┐  after each conversation turn  ┌──────────────────┐
│  Router   │──────────────────────────────→│  MemoryExtractor  │
│           │                               │  (async, non-blocking)│
│           │                               │  1. Call Haiku to    │
│           │                               │     extract facts    │
│           │                               │  2. Append to        │
│           │                               │     MEMORY.md        │
│           │                               │  3. Daily compaction │
│           │                               └──────────────────┘
```

**New module:** `src/memory/extractor.ts`

```typescript
export class MemoryExtractor {
  /**
   * Async, fire-and-forget. Called after each assistant reply.
   * Extracts noteworthy facts and appends to MEMORY.md.
   */
  async extract(userID: string, userMessage: string, assistantReply: string): Promise<void>;

  /**
   * Compact MEMORY.md — merge duplicates, expire old entries.
   * Scheduled via setInterval (daily at 3AM per config).
   */
  async compact(userID: string): Promise<void>;
}
```

**Extraction prompt (to Claude Haiku):**
```
Given this conversation turn, extract 0-3 facts worth remembering long-term.
Output JSON array: [{"fact": "...", "category": "preference|decision|context|skill"}]
If nothing noteworthy, output [].
```

**Append format** (in MEMORY.md):
```markdown
## Extracted 2026-03-23
- [preference] User prefers Go over Python for backend work
- [context] Working on project "deer-flow" for Xiaomi
```

**Compaction:** Use config values that already exist (`memory.compaction.*`):
- `schedule: "0 3 * * *"` → setInterval check every hour, run if time matches
- `max_file_size: "50KB"` → trigger compaction if MEMORY.md exceeds 50KB
- `summarize_threshold: 20` → if >20 entries, call Haiku to merge/deduplicate
- `expire_overridden_days: 30` → remove entries older than 30 days that were superseded

---

### 2.3 Image & File Message Support

**Problem:** Feishu adapter silently drops all non-text messages (line 141: `if (message.message_type !== "text") return null`).

**Design:**

```
┌──────────┐  image message   ┌──────────────────┐
│  Feishu   │────────────────→│  FeishuAdapter     │
│  WebSocket│                 │  1. Detect type    │
│           │                 │  2. Download via   │
│           │                 │     Feishu API     │
│           │                 │  3. Save to        │
│           │                 │     workspace/     │
│           │                 │     uploads/       │
│           │                 └────────┬───────────┘
                                       │
                              ┌────────▼───────────┐
                              │  Router             │
                              │  prompt = "[Image:  │
                              │  /path/to/img.png]  │
                              │  <user question>"   │
                              │                     │
                              │  CLI --add-dir      │
                              │  includes uploads/  │
                              └─────────────────────┘
```

**Changes:**

| File | Change |
|------|--------|
| `src/platform/types.ts` | Extend `MessageEvent` with `attachments?: Attachment[]` |
| `src/platform/feishu/adapter.ts` | Handle `image`, `file`, `media` message types; download via Feishu API |
| `src/router/router.ts` | Prepend attachment info to prompt text |
| `src/workspace/workspace.ts` | Add `uploadsDir(userID)` path helper |

**Supported message types:**

| Feishu type | Handling |
|---|---|
| `text` | Existing (unchanged) |
| `image` | Download → save to uploads/ → add path to prompt |
| `file` | Download → save to uploads/ → add path to prompt |
| `post` (rich text) | Extract plain text + images |
| `audio`, `video` | Reply with "Unsupported format" message |

**Attachment type:**
```typescript
interface Attachment {
  type: "image" | "file";
  path: string;      // local path after download
  name: string;      // original filename
  mimeType?: string;
}
```

**Prompt rewriting:**
```
[Attached files: /workspace/uploads/ou_xxx/screenshot.png]
Please analyze this screenshot and tell me what you see.
```

The `--add-dir` flag already grants Claude CLI access to the user workspace directory. Uploaded files placed there are automatically accessible.

---

## Phase 3: Architecture Upgrade (P2)

### 3.1 Parallel Sub-tasks

**Problem:** Only `/dev` runs as a separate subprocess. No way to split complex work into parallel tracks.

**Design:** Extend dev-agent into a general-purpose **TaskRunner** that supports parallel subprocess spawning.

```
┌──────────┐  /run "task1" "task2" "task3"  ┌─────────────────┐
│  User     │──────────────────────────────→│  TaskRunner      │
│           │                               │  spawn 3 CLI     │
│           │                               │  subprocesses    │
│           │←── progress per task ─────────│  concurrently    │
│           │←── final combined result ─────│  (max 3 workers) │
│           │                               └─────────────────┘
```

**New module:** `src/runner/task-runner.ts`

```typescript
interface TaskDefinition {
  id: string;
  description: string;
  prompt: string;
  workDir: string;
}

interface TaskRunnerConfig {
  maxConcurrent: number;  // default: 3 (from config.agent.max_concurrent_per_agent)
  timeoutMs: number;
  model?: string;
}

class TaskRunner {
  /** Run multiple tasks concurrently, report progress to Feishu. */
  async runParallel(
    tasks: TaskDefinition[],
    sender: PlatformSender,
    chatID: string,
  ): Promise<TaskResult[]>;
}
```

**Concurrency control:** Simple semaphore pattern — `Promise.allSettled` with a concurrency limiter (p-limit style, inline implementation to avoid dependency).

**Progress reporting:** Each task sends its own Feishu message with status updates. A summary card is sent when all tasks complete.

**Integration:** New `/run` slash command, or the lead agent can use it when it detects parallelizable sub-tasks in the user's request.

---

### 3.2 Intelligent Error Recovery

**Problem:** All errors produce the same generic "Sorry, I encountered an error" message.

**Design:** Error classification + targeted recovery strategies.

**New module:** `src/error/classifier.ts`

```typescript
enum ErrorType {
  TIMEOUT = "timeout",
  RATE_LIMIT = "rate_limit",
  CONTEXT_OVERFLOW = "context_overflow",
  MODEL_ERROR = "model_error",
  CLI_NOT_FOUND = "cli_not_found",
  AUTH_ERROR = "auth_error",
  UNKNOWN = "unknown",
}

interface ClassifiedError {
  type: ErrorType;
  message: string;
  retryable: boolean;
  userMessage: string;  // human-friendly message for Feishu
  recovery?: () => Promise<void>;
}

function classifyError(err: Error, stderr: string): ClassifiedError;
```

**Recovery strategies per error type:**

| Error Type | Detection | Recovery |
|---|---|---|
| `TIMEOUT` | `err.killed` or signal | Inform user with elapsed time, suggest shorter prompt |
| `RATE_LIMIT` | stderr contains "rate limit" / 429 | Auto-retry after 30s, inform user "Rate limited, retrying..." |
| `CONTEXT_OVERFLOW` | Existing `isContextOverflow()` | Current reset + replay (improved with summarization from 1.2) |
| `MODEL_ERROR` | stderr contains "model" / 500 / 503 | Fallback to Haiku, inform user "Falling back to faster model" |
| `CLI_NOT_FOUND` | `ENOENT` error code | "Claude CLI not found. Please install: npm install -g @anthropic-ai/claude-code" |
| `AUTH_ERROR` | stderr contains "auth" / 401 / "API key" | "Authentication failed. Please check your API key configuration." |

**Changes:**

| File | Change |
|------|--------|
| New `src/error/classifier.ts` | Error classification logic |
| `src/router/router.ts` | Replace generic catch with `classifyError()`, show targeted message |
| `src/claude/client.ts` | Pass stderr through to caller (currently only in error.message) |

---

## Implementation Schedule

```
Phase 1 — P0 Experience Fixes (Week 1-2)
├── 1.1 Streaming Output
│   ├── Step 1: askStreaming() in claude/client.ts (spawn + stream-json parser)
│   ├── Step 2: updateMarkdown() in feishu/client.ts (im.message.patch)
│   ├── Step 3: Streaming loop in router.ts (throttled updates)
│   └── Step 4: Fallback to buffered mode on error
│
├── 1.2 Context Summarization
│   ├── Step 1: Token estimation utility (char/4 heuristic)
│   ├── Step 2: ContextManager with summarize() using Haiku
│   ├── Step 3: Integrate into router before each ask()
│   └── Step 4: Config options in config.json
│
└── 1.3 Session Persistence
    ├── Step 1: Session.toJSON() / fromJSON()
    ├── Step 2: SessionManager.saveToDisk() with 5s debounce
    ├── Step 3: SessionManager.loadFromDisk() on startup
    └── Step 4: Graceful shutdown saves to disk

Phase 2 — P1 Capability Expansion (Week 3-4)
├── 2.1 MCP Integration
│   ├── Step 1: Add --mcp-config to CLI args
│   ├── Step 2: Add mcp section to config.json
│   ├── Step 3: Create mcp-config.json template
│   └── Step 4: Pass through to dev-agent
│
├── 2.2 Active Memory System
│   ├── Step 1: MemoryExtractor with Haiku-based fact extraction
│   ├── Step 2: Async post-conversation extraction in router
│   ├── Step 3: Compaction scheduler (daily, config-driven)
│   └── Step 4: Memory stats in WebUI /api/status
│
└── 2.3 Image & File Support
    ├── Step 1: Feishu API file download utility
    ├── Step 2: Extend adapter for image/file message types
    ├── Step 3: Uploads directory management
    └── Step 4: Prompt rewriting with attachment paths

Phase 3 — P2 Architecture Upgrade (Week 5-6)
├── 3.1 Parallel Sub-tasks
│   ├── Step 1: TaskRunner with semaphore-based concurrency
│   ├── Step 2: /run slash command
│   ├── Step 3: Progress reporting per task
│   └── Step 4: Combined result synthesis
│
└── 3.2 Intelligent Error Recovery
    ├── Step 1: Error classifier with pattern matching
    ├── Step 2: Per-type recovery strategies
    ├── Step 3: Replace generic error handler in router
    └── Step 4: Model fallback logic
```

---

## File Impact Summary

### New Files (6)
| File | Purpose |
|------|---------|
| `src/context/manager.ts` | Token estimation + context summarization |
| `src/memory/extractor.ts` | LLM-based fact extraction + compaction |
| `src/runner/task-runner.ts` | Parallel subprocess orchestration |
| `src/error/classifier.ts` | Error classification + recovery strategies |
| `mcp-config.json` | MCP server configurations (template) |
| `docs/architecture-v2-plan.md` | This document |

### Modified Files (9)
| File | Changes |
|------|---------|
| `src/claude/client.ts` | Add `askStreaming()`, add `--mcp-config` arg |
| `src/backend/index.ts` | Add streaming dispatch, pass mcpConfigPath |
| `src/router/router.ts` | Streaming response loop, context check, memory extraction, error classification |
| `src/router/commands.ts` | Add `/run` command |
| `src/session/session.ts` | Add `toJSON()` / `fromJSON()` |
| `src/session/manager.ts` | Add persistence (save/load), debounced disk writes |
| `src/platform/types.ts` | Add `updateMarkdown()`, `Attachment` type, extend `MessageEvent` |
| `src/platform/feishu/client.ts` | Implement `updateMarkdown()` via `im.message.patch` |
| `src/platform/feishu/adapter.ts` | Handle image/file messages, download attachments |
| `src/index.ts` | Load sessions on startup, init ContextManager + MemoryExtractor |
| `config.json` | Add `mcp`, `context` sections |

### Untouched (kept as-is)
| File | Reason |
|------|--------|
| `src/router/dev-agent.ts` | Already uses spawn + stream-json; refactor later to use TaskRunner |
| `src/router/sentiment.ts` | Working fine, no changes needed |
| `src/opencode/client.ts` | Lower priority backend, streaming deferred |
| `src/webui/*` | Working fine, minor additions only (memory stats) |
| `src/workspace/workspace.ts` | Add `uploadsDir()` helper only |

---

## Design Principles

1. **CLI-first:** Every capability routes through Claude CLI. We don't reimplement what the CLI already does.
2. **Async non-blocking:** Memory extraction, compaction, and reactions are all fire-and-forget. Never block the main response path.
3. **Graceful degradation:** Every new feature has a fallback to current behavior. Streaming fails → buffered. Summarization fails → skip. MCP fails → CLI without MCP.
4. **Minimal dependencies:** No new npm packages. Token estimation via char heuristic. Concurrency via inline semaphore. Persistence via JSON files.
5. **Config-driven:** Every new behavior is gated by config.json flags. Can be enabled/disabled without code changes.
