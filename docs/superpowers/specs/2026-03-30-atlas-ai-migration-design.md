# Atlas AI — Migration Design Spec

**Date:** 2026-03-30
**Status:** Approved
**Source:** happy-main → feishu-ai-assistant (renamed atlas-ai)

## Overview

Migrate happy-main's CLI, agent architecture, and wire protocol into the feishu-ai-assistant project, redesigned as a **channel-agnostic, local-only AI gateway** called **atlas-ai**. The mobile app (happy-app) is NOT ported; instead, its display and interaction patterns are mapped onto channel-native formats (Feishu cards, Telegram messages, etc.).

## Key Design Decisions

### 1. No Server Relay

feishu-ai-assistant runs locally. It makes outbound WebSocket connections to Feishu Cloud — no public IP required. happy-main's server (`happy-server`) exists for multi-device cloud sync with E2E encryption — a problem we don't have. **The server package is dropped entirely.**

Data flow:
```
User ↔ Channel Cloud (Feishu/Telegram/...) ←outbound connection→ Local Process ↔ Agent CLI (subprocess)
```

### 2. Channel-Agnostic Architecture

All packages use `atlas-*` naming. Channel adapters are plugins. The core gateway knows nothing about Feishu, Telegram, or any specific platform. This allows adding new channels without touching core code.

### 3. Agent Layer Replacement

The existing agent backends are replaced wholesale with happy-main's `AgentBackend`/`AgentRegistry`/ACP/`TransportHandler` architecture, providing the 13-type `AgentMessage` union and ACP protocol support.

## Architecture

### Monorepo Structure

```
atlas-ai/
├── package.json                    # workspaces: ["packages/*"]
├── tsconfig.base.json              # Shared TS config
├── packages/
│   ├── atlas-wire/                 # Shared protocol schemas (Zod)
│   ├── atlas-agent/                # Agent backends (from happy-main)
│   ├── atlas-gateway/              # Core gateway engine + channel adapters
│   ├── atlas-app-logs/             # HTTP log receiver
│   └── atlas-cli/                  # CLI entry point + daemon
└── docs/
```

**Note on channel adapters:** Channel adapters (Feishu, Telegram, DingTalk, Discord) live as modules within `atlas-gateway/channel/` rather than separate packages. The Telegram/DingTalk/Discord adapters are each ~1 file; extracting to separate packages would add overhead without benefit. They can be extracted later if they grow.

**Note on encryption:** `atlas-crypto` is deferred from initial scope. No concrete use case exists in a local-only architecture. Can be added when needed.

### Dependency Graph

```
atlas-cli ──→ atlas-gateway ──→ atlas-wire
                   │
                   └──→ atlas-agent ──→ atlas-wire

atlas-app-logs (standalone, no cross-package deps)
```

---

## Package Designs

### atlas-wire — Wire Protocol

Shared Zod schemas defining all message types. Forked from `happy-wire`, adapted to be channel-agnostic. This package contains ONLY agent/session message schemas — no channel-specific types.

```
atlas-wire/src/
  messages.ts           # Core message schemas
  messageMeta.ts        # Per-message metadata (permissionMode, model, systemPrompt)
  sessionProtocol.ts    # Session event envelopes
  sessionControl.ts     # Session lifecycle events (create, pause, resume, destroy)
  voice.ts              # Voice schemas (optional)
  index.ts
```

**Ported from happy-wire:**
- `MessageContentSchema` (discriminated union: UserMessage / AgentMessage / SessionProtocolMessage)
- `SessionMessageSchema` (message container with id, seq, timestamps)
- `MessageMetaSchema` (permissionMode, model, systemPrompt, allowedTools)
- `CoreUpdateBodySchema` / `CoreUpdateContainerSchema` (real-time update types)

**Removed:**
- `VersionedEncryptedValueSchema` (encryption is optional, not core)

**Added:**
- `sessionControl.ts` — session lifecycle wire events

**Note:** Channel-specific event/card schemas (`channelEvent.ts`, `channelCard.ts`) live in `atlas-gateway/channel/` rather than here, to keep the wire package purely about agent/session protocol.

### atlas-agent — Agent Layer

Direct port of `happy-cli/src/agent/` with the mobile-specific adapters removed.

```
atlas-agent/src/
  core/
    AgentBackend.ts       # Interface (see full definition below)
    AgentMessage.ts       # 13-type union (canonical source, see list below)
    AgentRegistry.ts      # Factory registry: register by AgentId, create(id, opts)
    AgentId.ts            # Agent ID type (see below)
  acp/
    AcpBackend.ts         # ACP protocol: spawn child, ndJSON streams, ClientSideConnection
    AcpSessionManager.ts  # Session lifecycle (decoupled from server HTTP calls)
    sessionUpdateHandlers.ts
  transport/
    TransportHandler.ts   # Agent-specific customization (timeouts, stderr, tool patterns)
    DefaultTransport.ts
    handlers/
      GeminiTransport.ts  # Gemini CLI quirks (matches happy-main source layout)
  index.ts
```

**`AgentId` type:**
```typescript
type AgentId =
  | 'claude' | 'claude-acp'    // native CLI vs ACP transport
  | 'codex' | 'codex-acp'      // native CLI vs ACP transport
  | 'gemini'                    // ACP-only
  | 'opencode'
  | 'openclaw'
  | 'cursor'                    // from existing feishu-ai-assistant
```

The `-acp` variants distinguish transport mode: `claude` uses direct CLI spawning with `--output-format stream-json`, while `claude-acp` uses the ACP protocol via `@agentclientprotocol/sdk`. Transport selection is by AgentId, not runtime config.

**`AgentBackend` interface (full):**
```typescript
interface AgentBackend {
  // Required
  startSession(initialPrompt?: string): Promise<string>  // returns sessionId
  sendPrompt(sessionId: string, prompt: string): Promise<void>
  cancel(sessionId: string): Promise<void>
  onMessage(handler: (msg: AgentMessage) => void): void
  dispose(): Promise<void>

  // Optional
  offMessage?(handler: (msg: AgentMessage) => void): void
  respondToPermission?(requestId: string, approved: boolean): Promise<void>
  waitForResponseComplete?(timeoutMs?: number): Promise<void>
}
```

**`AgentMessage` union (13 types, canonical from `AgentMessage.ts`):**
1. `model-output` — text streaming
2. `status` — lifecycle events
3. `tool-call` — tool invocation start
4. `tool-result` — tool invocation result
5. `permission-request` — agent asks for permission
6. `permission-response` — permission granted/denied
7. `fs-edit` — file system edit
8. `terminal-output` — terminal/command output
9. `event` — extensible custom events
10. `token-count` — token usage stats
11. `exec-approval-request` — execution approval (Codex-specific)
12. `patch-apply-begin` — patch application start (Codex-specific)
13. `patch-apply-end` — patch application end (Codex-specific)

**Note:** The inline `AgentMessage` duplicate in `AgentBackend.ts` is NOT ported. `AgentMessage.ts` is the single canonical definition.

**Removed from happy-main:**
- `MobileMessageFormat.ts`, `MessageAdapter.ts` (mobile-specific)
- Server API calls from `AcpSessionManager` (decoupled, speaks wire protocol only)

**Added:**
- `cursor` to `AgentId` (from existing feishu-ai-assistant)

**Note on daemon:** The daemon system (`controlClient`, `controlServer`, `manager`) is placed in `atlas-cli/`, NOT `atlas-agent/`. The daemon manages the gateway lifecycle (all channels + agents), not individual agent backends.

### atlas-gateway — Core Engine

The central orchestrator. Replaces both the dropped server and the previous `Engine` class. Runs in-process, no network between components. Also contains channel adapters as internal modules.

```
atlas-gateway/src/
  engine.ts               # Central orchestrator: channel ↔ agent routing
  config.ts               # Config loading with env expansion
  channel/
    ChannelAdapter.ts     # Interface (see full definition below)
    ChannelSender.ts      # Interface (see full definition below)
    ChannelRegistry.ts    # Plugin registry for channel adapters
    channelEvent.ts       # Normalized inbound event schema (Zod)
    channelCard.ts        # Abstract outbound card schema (Zod)
    feishu/               # Feishu channel adapter
      adapter.ts
      client.ts
      cardRenderer.ts
      eventParser.ts
      actionHandler.ts
    telegram/             # Telegram channel adapter
      adapter.ts
      client.ts
      cardRenderer.ts
    dingtalk/             # DingTalk channel adapter
      adapter.ts
      client.ts
    discord/              # Discord channel adapter
      adapter.ts
      client.ts
  cards/
    CardEngine.ts         # Wire AgentMessage → CardModel
    CardModel.ts          # Abstract card model (see definition below)
    StreamingCard.ts      # Live-updating card (batched token output)
    PermissionCard.ts     # Interactive permission request card
    ToolCallCard.ts       # Tool call status visualization
    SessionControlCard.ts # Session management card (new/stop/model switch)
    ErrorCard.ts          # Error display card
  session/
    SessionManager.ts     # Lifecycle: create, pause, resume, destroy (file-persisted)
    SessionQueue.ts       # Per-session serial async message queue
    SessionBridge.ts      # Maps channel chat_id ↔ wire session_id
  command/
    CommandRegistry.ts    # Slash command registry with prefix matching
    builtins.ts           # Built-in commands: /new, /stop, /model, /sessions, /help, etc.
  access/
    RateLimiter.ts        # Sliding-window rate limiter
    RoleManager.ts        # RBAC with per-role limits and disabled commands
  scheduling/
    CronScheduler.ts      # Scheduled prompts
  logging/
    Logger.ts             # Structured JSON logger with token redaction
  memory/
    MemoryManager.ts      # Per-user CLAUDE.md, MEMORY.md management
    ContextManager.ts     # Context window management
  management/
    ManagementApi.ts      # Local-only REST API for admin control
  webui/
    WebUiServer.ts        # Express WebUI (config editor, SSE events, QR code)
  index.ts
```

**`ChannelAdapter` interface:**
```typescript
interface ChannelAdapter {
  readonly id: string                    // e.g., 'feishu', 'telegram'
  start(handler: MessageHandler): Promise<void>  // push-based: handler called on each message
  stop(): Promise<void>
  getSender(chatId: string): ChannelSender
}

type MessageHandler = (event: ChannelEvent) => Promise<void>

// ChannelEvent is a normalized inbound event (defined in channelEvent.ts via Zod)
interface ChannelEvent {
  channelId: string      // adapter id ('feishu', 'telegram', etc.)
  chatId: string         // channel-specific chat identifier
  userId: string         // channel-specific user identifier
  userName: string       // display name
  messageId: string      // channel-specific message identifier
  content: UserMessageContent  // text, image, file, audio
  timestamp: number
  replyToId?: string     // if this is a reply to another message
}
```

**`ChannelSender` interface:**
```typescript
interface ChannelSender {
  // Core — all channels must implement
  sendText(text: string, replyTo?: string): Promise<string>          // returns messageId
  sendMarkdown(md: string, replyTo?: string): Promise<string>        // plain markdown (no buttons)
  sendCard(card: CardModel, replyTo?: string): Promise<string>       // structured card with buttons/sections
  updateCard(messageId: string, card: CardModel): Promise<void>      // update existing card in-place

  // Optional capabilities (detected at runtime)
  addReaction?(messageId: string, emoji: string): Promise<void>
  removeReaction?(messageId: string, emoji: string): Promise<void>
  sendImage?(imageData: Buffer, replyTo?: string): Promise<string>
  sendFile?(fileData: Buffer, filename: string, replyTo?: string): Promise<string>
  sendAudio?(audioData: Buffer, replyTo?: string): Promise<string>
  showTyping?(chatId: string): Promise<void>
}
```

**Note:** `sendMarkdown` is kept separate from `sendCard` because many agent responses are plain markdown text that don't need interactive card structure. `sendCard` is for structured cards with buttons, sections, and interactive elements.

**`CardModel` interface:**
```typescript
interface CardModel {
  header?: CardHeader
  sections: CardSection[]
  actions?: CardAction[]
}

interface CardHeader {
  title: string
  subtitle?: string
  icon?: string          // emoji or icon identifier
  status?: 'running' | 'done' | 'error' | 'waiting'
}

interface CardSection {
  type: 'markdown' | 'fields' | 'divider' | 'note'
  content?: string       // for markdown type
  fields?: CardField[]   // for fields type
}

interface CardField {
  label: string
  value: string
  short?: boolean        // display in half-width column
}

interface CardAction {
  type: 'button' | 'select'
  label: string
  value: string          // callback value
  style?: 'primary' | 'danger' | 'default'
}
```

Each channel adapter's `CardRenderer` converts this abstract `CardModel` to channel-native format:
- **Feishu:** Interactive card JSON (`msg_type: "interactive"`)
- **Telegram:** Inline keyboard markup + formatted text
- **DingTalk:** ActionCard message
- **Discord:** Embed + button components

**App UI pattern mapping (core workflow):**

| happy-main App Pattern | atlas-gateway Card | Channel Rendering |
|------------------------|-------------------|-------------------|
| Chat streaming | `StreamingCard` — markdown, updated in-place | Feishu: `im.message.patch`; Telegram: `editMessageText` |
| Tool call status | `ToolCallCard` — icon + name + status badge | Feishu: card element; Telegram: inline text |
| Permission request | `PermissionCard` — Allow/Deny/AllowAll buttons | Feishu: interactive card; Telegram: inline keyboard |
| Session control | `SessionControlCard` — New/Stop/Model buttons | Feishu: interactive card; Telegram: inline keyboard |
| Error display | `ErrorCard` — classified error with retry hint | Feishu: callout card; Telegram: formatted text |
| Agent status | Card header badge: agent + model + duration | Feishu: card header; Telegram: message prefix |

### atlas-cli — CLI Entry Point + Daemon

```
atlas-cli/src/
  index.ts              # Entry point, raw argv parsing (like happy-main)
  commands/
    start.ts            # Start gateway with configured channels + agents
    daemon.ts           # daemon start/stop/status/list/logs
    auth.ts             # Channel credential management
    session.ts          # session list/resume/drop
    doctor.ts           # Diagnostics
  daemon/
    controlClient.ts    # IPC client for daemon communication
    controlServer.ts    # IPC server
    manager.ts          # Background process management
  config.ts             # CLI config (~/.atlasOS/)
```

**Commands:**
- `atlas start` — start gateway + all configured channels
- `atlas daemon start/stop/status/list/logs` — background service
- `atlas auth setup <channel>` — configure channel credentials
- `atlas session list/resume/drop` — session management
- `atlas doctor` — diagnostics, kill runaway processes

### atlas-app-logs — HTTP Log Receiver

```
atlas-app-logs/src/
  server.ts             # HTTP server (configurable port)
  writer.ts             # Log file writer (~/.atlasOS/app-logs/)
  format.ts             # Log entry formatting
  index.ts
```

- `POST /logs` accepts `{timestamp, level, message, source, platform}`
- Writes to stdout + timestamped log file
- Gateway sends its own operational logs here too

---

## Data Flow

```
User in Channel (Feishu/Telegram/...)
  │
  │  (channel-specific protocol: WebSocket/polling/webhook)
  ▼
Channel Adapter (atlas-gateway/channel/*)
  │  eventParser: channel event → wire UserMessage
  ▼
Gateway Engine (atlas-gateway)
  │  SessionBridge: map chat_id → session_id
  │  CommandRegistry: check for /slash commands
  │  SessionQueue: serialize per-session
  ▼
Agent Backend (atlas-agent)
  │  AgentRegistry: resolve agent type
  │  AcpBackend/DirectBackend: spawn CLI subprocess
  │  TransportHandler: agent-specific protocol handling
  │
  │  ← AgentMessage stream (model-output, tool-call, permission-request, etc.)
  ▼
Gateway Engine
  │  CardEngine: AgentMessage → CardModel
  ▼
Channel Adapter
  │  CardRenderer: CardModel → channel-native format
  │  ChannelSender: send/update card in channel
  ▼
User sees response in Channel
```

**Permission flow:**
```
Agent → permission-request → Gateway → PermissionCard → Channel (interactive buttons)
User clicks Allow → Channel → actionHandler → wire permission-response → Gateway → Agent
```

**Startup sequence:**
1. `atlas start` reads `~/.atlasOS/config.json`
2. Registers agent backends from config (Claude, Codex, Gemini, etc.)
3. Starts configured channel adapters (Feishu WebSocket, Telegram polling, etc.)
4. Starts optional services (WebUI, Management API, App Logs, Cron)
5. Ready for messages

---

## Connection Resilience

**Channel reconnection:**
- Feishu WebSocket: The `@larksuiteoapi/node-sdk` WSClient handles auto-reconnection internally. The adapter monitors connection state and logs disconnects/reconnects.
- Telegram polling: Polling loop retries with exponential backoff (1s → 2s → 4s → max 30s) on HTTP errors.
- Discord/DingTalk: Similar reconnection strategies built into their respective SDKs.

**Agent crash recovery:**
- If an agent subprocess crashes, `AcpBackend` detects the closed stream and emits a `status: 'error'` AgentMessage.
- The gateway marks the session as `error` state, sends an ErrorCard to the user, and offers a "Restart Session" button.
- On restart, a new subprocess is spawned. Session history is replayed from the file-persisted session log.

**Message delivery:**
- Best-effort delivery. If a channel send fails (rate limit, network), the gateway retries up to 3 times with exponential backoff.
- Messages that fail all retries are logged to app-logs with the full payload for manual inspection.

---

## Config Migration

The `~/.atlasOS/` config directory is preserved but the config schema changes. On first startup of atlas-ai:

1. If `~/.atlasOS/config.json` exists with old format, back it up to `~/.atlasOS/config.json.v1.bak`
2. Generate a new `config.json` with the atlas-ai schema, migrating compatible fields (credentials, channel configs, agent selections)
3. Fields that cannot be auto-migrated are logged with instructions for manual setup

Config version field is added: `"version": 2` to distinguish old vs new format.

---

## Migration Scope

### From happy-main (port):
- `packages/happy-cli/src/agent/` → `atlas-agent` (core, acp, transport)
- `packages/happy-wire/src/` → `atlas-wire` (schemas, adapted)
- `packages/happy-app-logs/src/` → `atlas-app-logs` (direct port)
- `packages/happy-cli/src/daemon/` → `atlas-cli/daemon/`
- App UI patterns → `atlas-gateway/cards/` (CardEngine, abstract card model)

### From feishu-ai-assistant (keep/evolve):
- `src/platform/feishu/` → `atlas-gateway/channel/feishu/` (restructured)
- `src/platform/telegram|dingtalk|discord/` → `atlas-gateway/channel/*/`
- `src/core/engine.ts` patterns → `atlas-gateway/engine.ts` (redesigned)
- `src/core/` utilities → `atlas-gateway/` (logger, ratelimit, dedup, cron, commands)
- Config system (`~/.atlasOS/`) → kept with migration
- WebUI → `atlas-gateway/webui/`

### NOT ported:
- `happy-server` (cloud relay — not needed)
- `happy-app` (mobile app — channels replace it)
- `happy-agent` (remote control CLI — not needed in local architecture)
- E2E encryption (deferred — no concrete use case in local architecture)
- Social features (friends, feed)
- GitHub integration
- Push notifications (channels handle their own)

## Testing Strategy

- Unit tests per package (Vitest)
- Integration tests: mock channel adapter + real agent backend
- Card rendering tests: verify CardModel → channel-native JSON for each channel
- Wire schema tests: Zod parse/validate roundtrips

## Tech Stack

- **Language:** TypeScript 5.x (strict, ESM)
- **Runtime:** Node.js >= 18
- **Build:** tsc, Yarn workspaces
- **Testing:** Vitest
- **Feishu SDK:** @larksuiteoapi/node-sdk
- **Agent Protocol:** @agentclientprotocol/sdk ^0.14.1 (published on npm, used by happy-main)
- **Schema Validation:** Zod
- **Optional:** Express (WebUI)
