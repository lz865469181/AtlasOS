# Engine Architecture Redesign

**Date:** 2026-03-25
**Status:** Approved
**Scope:** Restructure feishu-ai-assistant to adopt Engine orchestrator pattern, port missing capabilities, delete redundant code

## Context

feishu-ai-assistant has grown organically with a flat router pattern, duplicated utilities, and unused modules. The Engine-based architecture pattern with capability interfaces, interactive permissions, workspace binding, and proper cron scheduling is the target.

**Goal:** Adopt Engine orchestrator pattern, add missing capabilities, and delete redundant code and architecture. The docs/ framework design remains the primary guide.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Architecture pattern | Engine orchestrator | Replaces flat router; centralizes session state machine, permission flow, streaming |
| Agent abstraction | Agent/AgentSession interfaces with factory registry | Replaces backend/ layer; each agent is self-contained |
| Session model | Hybrid: persistent for Claude Code, per-turn for others | Claude Code has bidirectional stdin protocol; others don't |
| Provider routing | Inside agents, per docs design | Scenario-based model selection + fallback chains |
| Deleted modules | task-runner, dev-agent, task-spawner, sentiment, clarification, tools/ | CLI agents handle these natively; tools/ never wired |

## Directory Structure

```
src/
  core/                          # Nucleus - NEVER imports agent/ or platform/
    engine.ts                    # Central orchestrator
    interfaces.ts                # All capability interfaces
    cards.ts                     # Platform-agnostic Card model + builder
    streaming.ts                 # Stream preview manager
    permission.ts                # Interactive permission flow
    dedup.ts                     # Message deduplication
    i18n.ts                      # Multi-language strings
    markdown.ts                  # Markdown strip/processing
    session/
      manager.ts                 # Session CRUD + persistence
      queue.ts                   # Per-session serial queue
      state.ts                   # InteractiveState per session (pending permission, message queue)
    command/
      registry.ts                # Command registry + custom commands with {{args}} templates
      builtin.ts                 # Built-in slash command handlers
    provider/
      types.ts                   # Provider/ProviderConfig interfaces
      router.ts                  # Scenario-based model routing
      proxy.ts                   # Anthropic API field rewriting proxy
    workspace/
      workspace.ts               # Workspace dirs + init
      binding.ts                 # Channel-to-workspace mapping
    cron.ts                      # Proper cron scheduler (field-level matching)
    relay.ts                     # Bot-to-bot relay
    ratelimit.ts                 # Sliding window + roles
    context.ts                   # Context summarization
    memory.ts                    # Memory extraction + compaction
    stt.ts                       # STT providers
    tts.ts                       # TTS providers
    error.ts                     # Error classifier
    utils.ts                     # Shared: createLineIterator, log, RedactToken
  agent/
    types.ts                     # Agent + AgentSession interfaces
    registry.ts                  # Factory registry (RegisterAgent/CreateAgent)
    claude/                      # Persistent process, bidirectional stdin/stdout JSON
      agent.ts
      session.ts
    codex/                       # Per-turn subprocess
      agent.ts
      session.ts
    gemini/                      # Per-turn subprocess
      agent.ts
      session.ts
    cursor/                      # Per-turn subprocess
      agent.ts
      session.ts
    opencode/                    # Per-turn subprocess
      agent.ts
      session.ts
  platform/
    types.ts                     # Platform + PlatformSender + optional capability interfaces
    registry.ts                  # Factory registry
    feishu/
      adapter.ts
      client.ts
      cards.ts
    telegram/adapter.ts
    discord/adapter.ts
    dingtalk/adapter.ts
  webui/
    server.ts
    events.ts
    static/index.html
  config.ts
  index.ts                       # Simplified bootstrap
```

## Core Interfaces

### Agent Layer

```typescript
interface Agent {
  name(): string;
  startSession(opts: SessionOptions): Promise<AgentSession>;
  listSessions(workDir: string): Promise<SessionInfo[]>;
  stop(): Promise<void>;
}

interface AgentSession {
  id(): string;
  send(msg: Message): Promise<void>;
  respondPermission(result: PermissionResult): Promise<void>;
  events(): AsyncIterable<AgentEvent>;
  close(): Promise<void>;
}

type AgentEvent =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "tool_use"; tool: string; input: string }
  | { type: "tool_result"; tool: string; output: string }
  | { type: "permission_request"; id: string; tool: string; input: string; questions?: AskQuestion[] }
  | { type: "result"; content: string; sessionId?: string; usage?: TokenUsage }
  | { type: "error"; message: string };
```

### Optional Capability Interfaces (agents)

```typescript
interface ModelSwitcher { setModel(model: string): void; availableModels(): Promise<ModelInfo[]>; }
interface ModeSwitcher { setMode(mode: string): void; availableModes(): string[]; }
interface LiveModeSwitcher { setLiveMode(mode: string): Promise<void>; }
interface ProviderSwitcher { setProviders(p: ProviderConfig[]): void; setActiveProvider(name: string): void; }
interface MemoryFileProvider { projectMemoryFile(): string; globalMemoryFile(): string; }
interface CommandProvider { commandDirs(): string[]; }
interface SkillProvider { skillDirs(): string[]; }
interface ContextCompressor { compressCommand(): string; }
interface UsageReporter { lastUsage(): TokenUsage | undefined; }
```

### Platform Layer

```typescript
interface Platform {
  name: string;
  start(handler: MessageHandler): Promise<void>;
  stop(): Promise<void>;
  getSender(): PlatformSender;
}

// Optional (unchanged from current - already well-designed)
interface CardSender { ... }
interface InlineButtonSender { ... }
interface ImageSender { ... }
interface AudioSender { ... }
interface TypingIndicator { ... }
interface MessageUpdater { ... }
```

### Provider Layer

```typescript
interface ProviderConfig {
  name: string;
  type: "cli" | "api";
  model: string;
  baseUrl?: string;
  apiKey?: string;
  thinking?: { type: string; budgetTokens?: number };
  env?: Record<string, string>;
}

interface RoutingEngine {
  route(session: SessionState, message: string): ProviderConfig;
}
```

## Engine Design

The Engine replaces `router/router.ts` as the central orchestrator.

### Message Flow

```
Platform.messageHandler(event, sender)
  └─> engine.handleMessage(event, sender)
       ├─ dedup.check(event.messageID) — skip if duplicate
       ├─ ratelimit.check(event.userID) — role-based, then global
       ├─ workspace.resolve(event.chatID) — binding lookup
       ├─ command.dispatch(event.text) — if starts with /
       ├─ permission.check(event) — if pending permission, resolve it
       ├─ session.tryLock() — if busy: queue message (max 5) or /btw inject
       └─ processInteractiveMessage()
            ├─ getOrCreateAgentSession()
            │   ├─ check interactiveStates map
            │   ├─ reuse existing session or create new
            │   └─ inject env vars, system prompt
            ├─ agentSession.send(message)
            └─ for await (event of agentSession.events())
                 ├─ text → accumulate + stream preview (throttled)
                 ├─ thinking → show indicator
                 ├─ tool_use → show tool card
                 ├─ permission_request → show card/buttons, await response
                 ├─ result → finalize reply, TTS if enabled, drain queued messages
                 └─ error → show error card
```

### InteractiveState (per session key)

```typescript
interface InteractiveState {
  agentSession: AgentSession;
  replyCtx: ReplyContext;          // platform + chatID + messageID for replies
  pending?: PendingPermission;     // blocked on user approval
  pendingMessages: QueuedMessage[]; // max 5, drained after EventResult
  approveAll: boolean;             // auto-approve permissions for this session
  quiet: boolean;                  // suppress output (muted cron)
}
```

### Permission Flow

1. Agent emits `permission_request` event with tool name, input, optional questions
2. Engine pauses idle timer, stores `PendingPermission` on session state
3. Engine sends interactive card (CardSender) or inline buttons (InlineButtonSender) to platform
4. User responds: allow / deny / allow-all (multi-language recognition)
5. Engine calls `agentSession.respondPermission()` with result
6. For `AskUserQuestion`: multi-step card flow with options, numeric selection, or free text

### Stream Preview

```typescript
interface StreamPreview {
  start(chatID: string, sender: PlatformSender): void;
  append(text: string): void;
  freeze(): void;    // pause updates during permission prompts
  discard(): void;   // abort
  finish(): string;  // final content
}
```

Throttled by interval (default 1500ms) and minimum delta chars (default 300). Uses `MessageUpdater.updateMessage()` for edit-in-place.

## Agent Implementations

### Claude Code (persistent process)

- Spawns `claude --output-format stream-json --input-format stream-json --permission-prompt-tool stdio`
- Process stays alive across multiple user messages
- Messages sent via stdin as newline-delimited JSON
- Permission requests received via stdout `control_request` events
- Permission responses written to stdin as `control_response` JSON
- Supports: ModelSwitcher, ModeSwitcher, LiveModeSwitcher, ProviderSwitcher, MemoryFileProvider, CommandProvider, SkillProvider, ContextCompressor, UsageReporter

### Codex, Gemini, Cursor, OpenCode (per-turn subprocess)

- Each `send()` spawns a new subprocess
- Session continuity via `--resume <threadID>` / `--session-id`
- No interactive permissions (CLI flags only: yolo, auto-edit, plan)
- Event parsing from stdout JSON lines
- `respondPermission()` is a no-op

## New Capabilities

| Capability | File | Description |
|---|---|---|
| Interactive permissions | `core/permission.ts` | Allow/deny/allow-all with multi-language, AskUserQuestion flow |
| Message deduplication | `core/dedup.ts` | 60s TTL dedup + stale message filter |
| Workspace binding | `core/workspace/binding.ts` | Channel-to-workspace mapping with shared fallback |
| Custom commands | `core/command/registry.ts` | Config + agent dir scanning, `{{1}}` `{{args}}` templates |
| Proper cron | `core/cron.ts` | Field-level cron matching (replace setInterval approximation) |
| i18n | `core/i18n.ts` | EN/ZH/ZH-TW/JA/ES, auto-detect by Unicode analysis |
| Provider proxy | `core/provider/proxy.ts` | Rewrite Anthropic API thinking fields for third-party providers |
| Streaming preview | `core/streaming.ts` | Freeze/discard/finish lifecycle |
| Markdown stripping | `core/markdown.ts` | For platforms without markdown support |

## Deleted Code

| Module | Reason |
|---|---|
| `src/backend/` | Replaced by `agent/` with proper interfaces |
| `src/claude/` | Merged into `agent/claude/` |
| `src/opencode/` | Merged into `agent/opencode/` |
| `src/router/router.ts` | Replaced by `core/engine.ts` |
| `src/router/commands.ts` | Replaced by `core/command/builtin.ts` |
| `src/router/dev-agent.ts` | CLI agents handle this natively |
| `src/router/task-spawner.ts` | CLI agents handle this natively |
| `src/router/clarification.ts` | CLI agents handle this natively |
| `src/router/sentiment.ts` | Removed (non-essential) |
| `src/runner/task-runner.ts` | CLI agents handle parallel tasks natively |
| `src/tools/` (all 8 files) | Never wired into chat flow; CLI agents use their own MCP tools |
| `src/scheduler/` | Merged into `core/cron.ts` with proper matching |
| `src/session/session.ts` Session class | Replaced by InteractiveState + AgentSession |
| Duplicated `createLineIterator` (4x) | Consolidated to `core/utils.ts` |
| Duplicated `log()` (12x) | Consolidated to `core/utils.ts` |

## Dependency Direction

```
index.ts → config.ts, core/*, agent/*, platform/*
agent/*   → core/   (never other agents or platforms)
platform/* → core/  (never other platforms or agents)
core/     → stdlib only (never agent/ or platform/)
```

This prevents circular dependencies and keeps each layer independently testable.

## Migration Strategy

1. **Phase 1 (Foundation):** Create `core/interfaces.ts`, `agent/types.ts`, `platform/types.ts`, `core/utils.ts`, registries
2. **Phase 2 (Engine):** Build `core/engine.ts` with message routing, session state machine
3. **Phase 3 (Agents):** Port each agent to Agent/AgentSession interface, Claude Code with persistent process
4. **Phase 4 (Capabilities):** Port permissions, dedup, workspace binding, custom commands, proper cron, i18n
5. **Phase 5 (Cleanup):** Delete old modules, consolidate duplicates, update index.ts bootstrap
6. **Phase 6 (Provider):** Add provider routing and proxy

Each phase should result in a working system (no big-bang rewrite).
