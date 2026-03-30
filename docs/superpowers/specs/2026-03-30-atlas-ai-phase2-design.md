# Atlas AI Phase 2 — Card Engine + Channel Integration Design

**Goal:** Map happy-main's display and interaction patterns onto Feishu (and other IM channels) via a card-based rendering pipeline with proper state management, streaming, and permission handling.

**Depends on:** Phase 1 (atlas-wire, atlas-agent, atlas-gateway interfaces, atlas-app-logs)

---

## Architecture Overview

```
AgentMessage stream (13 types from atlas-agent)
       |
       v
   CardEngine ─────────> CardStateStore <──── MessageCorrelationStore
       |                       |                        |
       |                  onChange (coalesced)           |
       |                       |                        |
       |                       v                        |
       |                CardRenderPipeline (serial)      |
       |                       |                        |
       |                       v                        |
       |                FeishuCardRenderer              |
       |                       |                        |
       |                       v                        |
       |                ChannelSender ──────────────────+
       |                                    (setMessageId callback)
       |
       +── StreamingStateMachine ──> StreamBuffer
       |         |                    (back-pressure)
       |         v
       |   CardStateStore.update()
       |
       +── PermissionCard
                |
                v
          PermissionPayloadValidator <── Feishu card.action.trigger
```

---

## 1. CardStateStore

**Package:** `atlas-gateway/src/engine/CardStateStore.ts`

Single source of truth for all live card states. Every card mutation goes through this store; the store emits change events that trigger renders.

### Anti-render-storm design

- **Coalesce window** (100ms): rapid mutations within window produce single render
- **Rate limit** (500ms per card): minimum interval between renders for any given card
- **Latest-state-wins**: when coalesce timer fires, reads current state (not stale snapshot)

```ts
interface CardState {
  cardId: string;
  messageId: string | null;     // Feishu message_id, null until first send
  chatId: string;
  type: 'streaming' | 'tool' | 'permission' | 'status';
  status: 'active' | 'frozen' | 'completed' | 'error' | 'expired';
  content: CardModel;
  version: number;
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>;
}

interface CardStateStoreConfig {
  maxRenderRateMs: number;    // default: 500
  coalesceWindowMs: number;   // default: 100
  maxPendingUpdates: number;  // default: 50
}

interface CardStateStore {
  create(chatId: string, type: CardState['type'], initial: CardModel): CardState;
  get(cardId: string): CardState | undefined;
  getByMessageId(messageId: string): CardState | undefined;
  getActiveByChatId(chatId: string): CardState[];
  update(cardId: string, mutator: (state: CardState) => void): CardState;
  transition(cardId: string, to: CardState['status']): CardState;
  setMessageId(cardId: string, messageId: string): void;
  dispose(cardId: string): void;
  onChange(handler: (cardId: string, state: CardState) => void): () => void;
  snapshot(): SerializedCardStore;
  restore(data: SerializedCardStore): void;
}
```

---

## 2. StreamingStateMachine

**Package:** `atlas-gateway/src/engine/StreamingStateMachine.ts`

7-state FSM for streaming agent text output, with back-pressure awareness and bounded buffer.

### States

```
IDLE ──start──> BUFFERING ──flush──> SENDING ──sent_ok──> BUFFERING
                  |   ^                |
                  |   +──timer─────────+    (throttle interval)
                  |
               permission──> PAUSED ──resume──> BUFFERING
                  |             |
                  |          timeout──> DRAINING ──done──> COMPLETED
                  |
               cancel──> CANCELLED
                  |
               error──> ERROR
                  |
               finish──> DRAINING ──done──> COMPLETED
```

- **IDLE**: no active stream
- **BUFFERING**: accumulating text, throttle timer running
- **SENDING**: card PATCH in-flight (buffer new chunks, don't send until previous completes)
- **PAUSED**: permission interrupt, buffer continues accumulating but no sends
- **DRAINING**: finish() called, send final accumulated content
- **COMPLETED**: terminal, card finalized
- **CANCELLED**: user abort
- **ERROR**: unrecoverable failure

### StreamBuffer

Bounded buffer with back-pressure signals:

```ts
interface StreamBufferConfig {
  maxBufferBytes: number;       // default: 65536 (64KB)
  highWaterMark: number;        // default: 49152 (75%)
  lowWaterMark: number;         // default: 16384 (25%)
  truncationStrategy: 'tail';   // keep most recent content
}
```

- `high_pressure` -> force flush even if throttle not met
- `truncated` -> prepend "... (truncated)\n", keep tail
- PAUSED state buffers with truncation (prevents OOM)

### Interface

```ts
interface StreamingStateMachine {
  readonly state: StreamingState;
  readonly buffer: StreamBuffer;
  readonly cardId: string;

  start(cardId: string): void;
  append(text: string): void;
  pause(reason: 'permission' | 'rate-limit'): void;
  resume(): void;
  finish(): Promise<string>;
  cancel(): void;
  error(err: Error): void;

  onSendComplete(): void;
  onSendError(err: Error): void;
  onFlush(handler: (content: string, cardId: string) => Promise<void>): void;
  onStateChange(handler: (from: StreamingState, to: StreamingState) => void): void;
}
```

---

## 3. CardRenderPipeline

**Package:** `atlas-gateway/src/engine/CardRenderPipeline.ts`

Subscribes to CardStateStore changes, renders CardModel to channel format, sends via ChannelSender. Full re-render on every state change (no partial patches).

### Anti-reorder design

- Per-card serial SendQueue (one PATCH in-flight at a time per card)
- Version check before send: skip if store has moved past this version
- Bounded queue depth (max 5): drop if too backed up

```ts
interface CardRenderer {
  render(card: CardModel, context: { status: string; type: string }): string;
}

class CardRenderPipeline {
  constructor(
    store: CardStateStore,
    renderer: CardRenderer,
    sender: ChannelSender,
    correlationStore: MessageCorrelationStore,
  );
}
```

---

## 4. MessageCorrelationStore

**Package:** `atlas-gateway/src/engine/MessageCorrelationStore.ts`

Maps between internal card IDs, Feishu message IDs, agent tool call IDs, and permission request IDs. Critical for routing tool-result back to the correct card.

```ts
interface CorrelationEntry {
  cardId: string;
  messageId: string | null;
  chatId: string;
  sessionId: string;
  toolCallId?: string;
  permissionRequestId?: string;
  createdAt: number;
  status: 'active' | 'completed' | 'expired';
}

interface MessageCorrelationStore {
  create(entry: Omit<CorrelationEntry, 'createdAt' | 'status'>): string;
  getByCardId(cardId: string): CorrelationEntry | undefined;
  getByMessageId(messageId: string): CorrelationEntry | undefined;
  getByToolCallId(sessionId: string, toolCallId: string): CorrelationEntry | undefined;
  getByPermissionId(sessionId: string, requestId: string): CorrelationEntry | undefined;
  resolveCardAction(messageId: string, payload: PermissionActionPayload): {
    card: CardState; entry: CorrelationEntry;
  } | null;
  setMessageId(cardId: string, messageId: string): void;
  complete(cardId: string): void;
  expire(olderThanMs: number): number;
  snapshot(): SerializedCorrelationStore;
  restore(data: SerializedCorrelationStore): void;
}
```

### Correlation flow

1. `tool-call` arrives -> CardEngine creates card -> CorrelationStore.create({ cardId, toolCallId })
2. RenderPipeline sends card -> gets Feishu messageId -> CorrelationStore.setMessageId(cardId, messageId)
3. `tool-result` arrives -> CorrelationStore.getByToolCallId() -> CardStateStore.update(cardId, ...)
4. Feishu card action -> CorrelationStore.resolveCardAction(messageId, payload) -> permission resolution

---

## 5. ToolCardBuilder

**Package:** `atlas-gateway/src/engine/ToolCardBuilder.ts`

Registry mapping tool names to CardModel builders. Port of happy-main's `knownTools` metadata, but produces CardModel instead of React components.

### 5 visual categories

| Category | Tools | Card body |
|----------|-------|-----------|
| **Terminal** | Bash, CodexBash, GeminiBash, shell, execute | Code block with command + output |
| **Diff** | Edit, Write, MultiEdit, CodexPatch, CodexDiff, GeminiPatch, GeminiDiff, edit | Code block with +/- markers |
| **ReadOnly** | Read, Glob, Grep, LS, search, WebFetch, WebSearch, NotebookRead | Minimal header-only or short text |
| **Interactive** | AskUserQuestion, ExitPlanMode | Description + buttons/select |
| **Meta** | TodoWrite, Task/Agent, NotebookEdit | Checklist or nested summary |

### Tool metadata

```ts
interface ToolCardMeta {
  title: string | ((input: Record<string, unknown>) => string);
  icon: string;          // emoji or icon name
  category: 'terminal' | 'diff' | 'readonly' | 'interactive' | 'meta';
  isMutable: boolean;
  minimal: boolean;      // header-only rendering
  hidden: boolean;       // skip rendering entirely
  buildCard(input: Record<string, unknown>, result?: unknown, status?: string): CardModel;
}

interface ToolCardBuilder {
  register(toolName: string, meta: ToolCardMeta): void;
  has(toolName: string): boolean;
  build(toolName: string, input: Record<string, unknown>, result?: unknown, status?: string): CardModel;
  getTitle(toolName: string, input: Record<string, unknown>): string;
  isHidden(toolName: string): boolean;
  isMutable(toolName: string): boolean;
}
```

---

## 6. PermissionCard + Payload Spec

**Package:** `atlas-gateway/src/engine/PermissionCard.ts`

### Payload spec (versioned, with nonce + timestamp)

```ts
interface PermissionActionPayload {
  v: 1;
  nonce: string;               // crypto.randomUUID()
  iat: number;                 // issued-at (Unix ms)
  exp: number;                 // expiry (iat + 5min default)
  action: PermissionAction;
  sessionId: string;
  requestId: string;
  toolName: string;
  toolCallId: string;
  agentType: 'claude' | 'codex' | 'gemini';
  scope?: PermissionScope;
}

type PermissionAction = 'approve' | 'approve_scoped' | 'deny' | 'abort';

type PermissionScope =
  | { type: 'this_tool'; toolIdentifier: string }
  | { type: 'all_edits' }
  | { type: 'session'; toolIdentifier?: string }
  | { type: 'command'; command: string };
```

### Validation

- Version check (v === 1)
- Expiry check (Date.now() <= exp)
- Nonce replay check (used nonces tracked with TTL cleanup)
- Zod schema validation

### Button sets (per agent type)

**Claude:** Yes / Yes allow all edits (edit tools only) / Yes for this tool / No tell Claude
**Codex:** Yes / Yes don't ask for session / Stop and explain
**Generic:** Approve / Deny

---

## 7. CardEngine

**Package:** `atlas-gateway/src/engine/CardEngine.ts`

Central component mapping AgentMessage -> CardStateStore mutations.

```ts
interface CardEngine {
  handleMessage(sessionId: string, chatId: string, msg: AgentMessage): void;
  handlePermissionResponse(sessionId: string, payload: PermissionActionPayload): void;
  getStreamingState(sessionId: string): StreamingStateMachine | undefined;
  dispose(sessionId: string): void;
}
```

### Message routing

| AgentMessage type | CardEngine action |
|---|---|
| `model-output` | Append to StreamingStateMachine, which updates CardStateStore |
| `status` | Update session status card header via CardStateStore |
| `tool-call` | Create tool card via ToolCardBuilder + CardStateStore + CorrelationStore |
| `tool-result` | Lookup via CorrelationStore, update card status to completed/error |
| `permission-request` | Pause streaming, create permission card with buttons |
| `permission-response` | Resume streaming, update permission card (highlight selected) |
| `fs-edit` | Create diff card (code block with +/- markers) |
| `terminal-output` | Append to active terminal tool card |
| `event` | Create note card |
| `token-count` | Update status card context percentage |
| `exec-approval-request` | Create permission card (exec variant) |
| `patch-apply-begin` | Create multi-file diff card |
| `patch-apply-end` | Update diff card with result |

---

## 8. SessionManager

**Package:** `atlas-gateway/src/engine/SessionManager.ts`

Maps chatId -> active agent session. Manages lifecycle.

```ts
interface SessionInfo {
  sessionId: string;
  chatId: string;
  agentId: AgentId;
  model?: string;
  permissionMode: string;
  createdAt: number;
  lastActiveAt: number;
}

interface SessionManager {
  getOrCreate(chatId: string, agentId?: AgentId): Promise<SessionInfo>;
  get(chatId: string): SessionInfo | undefined;
  destroy(chatId: string): Promise<void>;
  switchAgent(chatId: string, agentId: AgentId): Promise<SessionInfo>;
  setModel(chatId: string, model: string): void;
  setPermissionMode(chatId: string, mode: string): void;
  listActive(): SessionInfo[];
  persist(): Promise<void>;
  restore(): Promise<void>;
}
```

Persistence: JSON file at `~/.atlasOS/sessions/sessions.json`.

---

## 9. CommandRegistry

**Package:** `atlas-gateway/src/engine/CommandRegistry.ts`

Slash command handling with prefix matching.

```ts
interface Command {
  name: string;
  aliases?: string[];
  description: string;
  execute(args: string, context: CommandContext): Promise<string | CardModel>;
}

interface CommandContext {
  chatId: string;
  userId: string;
  sessionManager: SessionManager;
  sender: ChannelSender;
}

interface CommandRegistry {
  register(command: Command): void;
  resolve(input: string): { command: Command; args: string } | null;
  listCommands(): Command[];
}
```

Built-in commands: `/agent`, `/model`, `/mode`, `/cancel`, `/status`, `/help`.

---

## 10. Engine (Orchestrator)

**Package:** `atlas-gateway/src/engine/Engine.ts`

Wires everything together.

```ts
interface Engine {
  start(): Promise<void>;
  stop(): Promise<void>;
  handleChannelEvent(event: ChannelEvent): Promise<void>;
  handleCardAction(event: CardActionEvent): Promise<void>;
}
```

Flow:
1. ChannelEvent arrives from adapter
2. Check CommandRegistry for slash commands
3. Route to SessionManager -> get/create session
4. Send prompt to AgentBackend
5. Pipe AgentMessage stream through CardEngine
6. CardEngine mutates CardStateStore
7. CardRenderPipeline renders + sends to channel

---

## 11. FeishuCardRenderer

**Package:** `atlas-gateway/src/channel/feishu/FeishuCardRenderer.ts`

Converts CardModel to Feishu interactive card JSON.

| CardModel element | Feishu element |
|---|---|
| header (title + status) | `{ "title": { "tag": "plain_text", "content": ... }, "template": colorByStatus }` |
| markdown section | `{ "tag": "markdown", "content": ... }` |
| divider section | `{ "tag": "hr" }` |
| fields section | `{ "tag": "column_set", "columns": [...] }` |
| note section | `{ "tag": "note", "elements": [{ "tag": "plain_text", "content": ... }] }` |
| button action | `{ "tag": "button", "text": {...}, "value": jsonPayload, "type": style }` |

Header color mapping: running=blue, done=green, error=red, waiting=yellow.

---

## 12. FeishuAdapter

**Package:** `atlas-gateway/src/channel/feishu/FeishuAdapter.ts`

Implements ChannelAdapter interface. Port + enhance existing code.

- `lark.WSClient` for incoming `im.message.receive_v1` events
- **New:** `card.action.trigger` event registration for button callbacks
- Message parsing (text, image, file, audio)
- Dedup (Set-based, max 1000 entries)
- Stale message filter (2 min max age)
- Mention stripping for group chats

---

## File Map

```
packages/atlas-gateway/src/
  engine/
    CardStateStore.ts              // card state management + anti-render-storm
    CardStateStore.test.ts
    StreamingStateMachine.ts       // 7-state FSM + StreamBuffer
    StreamingStateMachine.test.ts
    CardRenderPipeline.ts          // full re-render + anti-reorder
    CardRenderPipeline.test.ts
    MessageCorrelationStore.ts     // ID mapping (card/message/toolCall/permission)
    MessageCorrelationStore.test.ts
    ToolCardBuilder.ts             // 5-category tool -> CardModel registry
    ToolCardBuilder.test.ts
    PermissionCard.ts              // permission card builder + payload validator
    PermissionCard.test.ts
    CardEngine.ts                  // AgentMessage -> CardStateStore mutations
    CardEngine.test.ts
    SessionManager.ts              // chatId -> session lifecycle
    SessionManager.test.ts
    CommandRegistry.ts             // slash commands
    CommandRegistry.test.ts
    Engine.ts                      // orchestrator
    Engine.test.ts
    index.ts                       // barrel export
  channel/
    feishu/
      FeishuCardRenderer.ts        // CardModel -> Feishu JSON
      FeishuCardRenderer.test.ts
      FeishuAdapter.ts             // ChannelAdapter impl
      FeishuAdapter.test.ts
      FeishuClient.ts              // low-level SDK wrapper
      index.ts
    index.ts
  index.ts                         // top-level barrel
```
