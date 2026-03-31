# Phase 3: Runtime Wiring Design

**Goal:** Bridge the abstract card engine (Phase 2) to live agent backends and Feishu WebSocket, producing a working end-to-end system.

**Architecture:** Thin bridge layer — `AgentBridge` manages agent lifecycle and message routing, `SessionQueue` ensures per-session serial execution, `PermissionService` handles permission business logic independently from card rendering. `atlas-cli` bootstraps everything via a testable `createApp()` factory.

**Tech Stack:** TypeScript 5.x strict ESM, Vitest, Lark SDK WebSocket (WSClient + EventDispatcher for both messages and card actions), atlas-agent AgentBackend/AgentRegistry.

---

## 1. Module Overview

### New Files

| Module | Package | Path | Responsibility |
|--------|---------|------|----------------|
| `SessionQueue` | atlas-gateway | `src/engine/SessionQueue.ts` | Per-session serial async queue |
| `AgentBridge` | atlas-gateway | `src/engine/AgentBridge.ts` | Agent lifecycle + message bridging |
| `PermissionService` | atlas-gateway | `src/engine/PermissionService.ts` | Permission validation + routing |
| `createApp` | atlas-cli | `src/createApp.ts` | Dependency wiring factory |
| `index` | atlas-cli | `src/index.ts` | Entry point: `createApp().start()` |

### Modified Files

| Module | Path | Change |
|--------|------|--------|
| `ChannelSender` | `src/channel/ChannelSender.ts` | Add `SenderFactory` type: `(chatId: string) => ChannelSender` |
| `FeishuAdapter` | `src/channel/feishu/FeishuAdapter.ts` | Add `onCardAction` to constructor opts; register card action in EventDispatcher |
| `ChannelEvent` | `src/channel/channelEvent.ts` | Add optional `threadId` field |
| `Engine` | `src/engine/Engine.ts` | Replace `permissionPayloadValidator` with `permissionService` in `EngineDeps`; simplify `handleCardAction` |
| `CardRenderPipeline` | `src/engine/CardRenderPipeline.ts` | Accept `SenderFactory` instead of single `ChannelSender` |
| `engine/index.ts` | `src/engine/index.ts` | Export new modules |

---

## 2. SessionQueue

Ported from v1 `src/core/session/queue.ts`. A generic per-key serial async queue that chains promises.

```typescript
export class SessionQueue {
  private queues = new Map<string, Promise<void>>();

  async enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(key) ?? Promise.resolve();
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const result = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    const chain = prev.then(async () => {
      try { resolve(await task()); }
      catch (err) { reject(err); }
    });
    this.queues.set(key, chain.catch(() => {}));
    return result;
  }

  remove(key: string): void { this.queues.delete(key); }
  has(key: string): boolean { return this.queues.has(key); }
  dispose(): void { this.queues.clear(); }
}
```

**Queue key strategy:**
- 1:1 chat: `chatId`
- Group with thread: `chatId:threadId`
- Group without thread: `chatId` (serializes all messages in the group)

The key is derived from `ChannelEvent`:
```typescript
export function sessionKey(event: ChannelEvent): string {
  return event.threadId ? `${event.chatId}:${event.threadId}` : event.chatId;
}
```

---

## 3. ChannelEvent Schema Update

Add optional `threadId` to support group thread granularity. The existing fields (`channelId`, `userName`, `replyToId`, etc.) are preserved — only `threadId` is added.

```typescript
export const ChannelEventSchema = z.object({
  channelId: z.string(),
  chatId: z.string(),
  userId: z.string(),
  userName: z.string(),
  messageId: z.string(),
  threadId: z.string().optional(),  // NEW — Feishu root_id for thread replies
  content: z.discriminatedUnion('type', [
    z.object({ type: z.literal('text'), text: z.string() }),
    z.object({ type: z.literal('image'), url: z.string(), mimeType: z.string().optional() }),
    z.object({ type: z.literal('file'), url: z.string(), filename: z.string(), mimeType: z.string().optional() }),
    z.object({ type: z.literal('audio'), url: z.string(), duration: z.number().optional() }),
  ]),
  timestamp: z.number(),
  replyToId: z.string().optional(),
});
```

In `FeishuAdapter.toChannelEvent()`, populate `threadId` from the Feishu message's `root_id` field (the thread root message ID). Only set it when `root_id` is present and differs from `message_id` (i.e., the message is a reply within a thread, not the thread root itself).

---

## 4. SenderFactory Abstraction

**Problem:** `FeishuChannelSender` requires a `chatId` at construction time (it's per-chat). But `CardRenderPipeline` needs to send cards to different chats. Currently it takes a single `ChannelSender`.

**Solution:** Introduce a `SenderFactory` type:

```typescript
// In ChannelSender.ts
export type SenderFactory = (chatId: string) => ChannelSender;
```

`CardRenderPipeline` constructor changes from:
```typescript
constructor(store, renderer, sender: ChannelSender, correlationStore)
```
to:
```typescript
constructor(store, renderer, senderFactory: SenderFactory, correlationStore)
```

The pipeline looks up the `chatId` from the card state (already stored in `CardState`) and calls `senderFactory(chatId)` to get the appropriate sender.

In production, the factory is:
```typescript
const senderFactory: SenderFactory = (chatId) =>
  new FeishuChannelSender(larkClient, chatId, renderer);
```

This also makes the pipeline channel-agnostic — future Telegram/Discord adapters provide their own sender factories.

---

## 5. AgentBridge

The core integration module. Implements `OnPromptCallback` and manages agent lifecycle.

### Interface

```typescript
export interface AgentBridgeConfig {
  agentId: AgentId;
  cwd: string;
  env?: Record<string, string>;
}

export interface AgentBridgeDeps {
  registry: AgentRegistry;
  cardEngine: CardEngineImpl;
  config: AgentBridgeConfig;
}

export class AgentBridge {
  /** Map<sessionId, { agent: AgentBackend, agentSessionId: string, handler: AgentMessageHandler }> */
  private sessions: Map<string, ManagedAgentSession>;
  private queue: SessionQueue;

  constructor(deps: AgentBridgeDeps);

  /** OnPromptCallback implementation */
  handlePrompt(session: SessionInfo, event: ChannelEvent): Promise<void>;

  /** Called by PermissionService when user approves/denies */
  respondToPermission(sessionId: string, requestId: string, approved: boolean): Promise<void>;

  /** Dispose a single session's agent */
  disposeSession(sessionId: string): Promise<void>;

  /** Dispose all */
  dispose(): Promise<void>;
}

interface ManagedAgentSession {
  agent: AgentBackend;
  agentSessionId: string;
  handler: AgentMessageHandler;  // stored so we can offMessage on dispose
}
```

### Agent Lifecycle

1. **First message for a session** → `AgentRegistry.create(agentId, { cwd, env })` → `agent.startSession()` → bind `onMessage` → store in sessions map
2. **Bind onMessage ONCE at creation** — the handler routes to `CardEngine.handleMessage(sessionId, chatId, msg)`. The handler reference is stored in `ManagedAgentSession.handler` so it can be unsubscribed on dispose.
3. **Subsequent messages** → reuse existing agent (looked up by `session.sessionId`), call `agent.sendPrompt(agentSessionId, text)`
4. **Session dispose** → `agent.offMessage?.(handler)`, `agent.dispose()`

### onMessage Handler (bound once per agent)

```typescript
private createMessageHandler(sessionId: string, chatId: string): AgentMessageHandler {
  return (msg: AgentMessage) => {
    this.cardEngine.handleMessage(sessionId, chatId, msg);
  };
}
```

### Serial Execution

```typescript
async handlePrompt(session: SessionInfo, event: ChannelEvent): Promise<void> {
  const key = sessionKey(event);
  await this.queue.enqueue(key, async () => {
    const managed = await this.getOrCreateAgent(session.sessionId, event.chatId);
    const text = event.content.type === 'text' ? event.content.text : '';
    if (!text) return;  // Skip non-text messages silently for now
    await managed.agent.sendPrompt(managed.agentSessionId, text);
  });
}
```

**Non-text message handling:** For Phase 3, non-text messages (image/file/audio) are silently skipped. Phase 4+ can add multimodal support by converting these to agent-compatible formats.

### Permission Response

```typescript
async respondToPermission(sessionId: string, requestId: string, approved: boolean): Promise<void> {
  const managed = this.sessions.get(sessionId);
  if (!managed) return;
  if (managed.agent.respondToPermission) {
    await managed.agent.respondToPermission(requestId, approved);
  }
  // If agent doesn't support respondToPermission, this is a no-op.
  // The card UI update is handled by PermissionService before calling this.
}
```

---

## 6. PermissionService

Extracts permission business logic from Engine. CardEngine only renders cards (UI), PermissionService makes decisions.

```typescript
export interface PermissionServiceDeps {
  validator: PermissionPayloadValidatorImpl;
  cardEngine: CardEngineImpl;
  bridge: AgentBridge;
}

export class PermissionService {
  constructor(deps: PermissionServiceDeps);

  /** Handle a card action event containing a permission response */
  async handleAction(event: CardActionEvent): Promise<void>;
}
```

Flow:
1. Parse `event.value` as `PermissionActionPayload`
2. Validate with `PermissionPayloadValidator` (nonce, timestamp, replay protection)
3. Extract `sessionId`, `requestId`, and `approved` from validated payload
4. Tell `CardEngine.handlePermissionResponse(sessionId, payload)` to update the card UI (show approved/denied state)
5. Call `AgentBridge.respondToPermission(sessionId, requestId, approved)` to notify the agent

This means:
- `Engine.handleCardAction()` delegates to `PermissionService.handleAction()`
- `CardEngine.handlePermissionResponse()` remains a pure UI update (renders the "approved" / "denied" card state)
- `AgentBridge.respondToPermission()` calls `agent.respondToPermission?.(requestId, approved)` with a guard for optional support

---

## 7. FeishuAdapter Card Action Support

The Feishu adapter currently only registers `im.message.receive_v1`. We need to also handle card action events via the same WebSocket connection.

### Constructor Change

Add `onCardAction` to the constructor opts:

```typescript
constructor(opts: {
  config: FeishuAdapterConfig;
  larkClient: LarkClient;
  wsClientFactory?: WSClientFactory;
  eventDispatcherFactory?: EventDispatcherFactory;
  renderer?: FeishuCardRenderer;
  onCardAction?: (event: CardActionEvent) => Promise<void>;  // NEW
})
```

### EventDispatcher Registration

In `FeishuAdapter.start()`, register the card action handler alongside the message handler:

```typescript
const handlers: Record<string, (data: unknown) => Promise<unknown>> = {
  'im.message.receive_v1': async (data) => { /* existing */ },
  'card.action.trigger': async (data) => {
    if (this.onCardAction) {
      const cardEvent = this.toCardActionEvent(data as FeishuCardActionEvent);
      if (cardEvent) await this.onCardAction(cardEvent);
    }
  },
};
```

### Card Action Event Mapping

New method `toCardActionEvent()` on FeishuAdapter:

```typescript
toCardActionEvent(data: FeishuCardActionEvent): CardActionEvent | null {
  const messageId = data.open_message_id;
  const chatId = data.open_chat_id;
  const userId = data.operator?.open_id;
  const value = data.action?.value;
  if (!messageId || !chatId || !userId || !value) return null;
  return {
    messageId,
    chatId,
    userId,
    value: value as Record<string, unknown>,
  };
}
```

`FeishuCardActionEvent` already exists in the codebase (lines 98-104 of FeishuAdapter.ts).

---

## 8. Engine Modifications

### `EngineDeps` Change

```typescript
export interface EngineDeps {
  cardStore: CardStateStoreImpl;
  correlationStore: MessageCorrelationStoreImpl;
  pipeline: CardRenderPipeline;
  cardEngine: CardEngineImpl;
  sessionManager: SessionManagerImpl;
  commandRegistry: CommandRegistryImpl;
  permissionService: PermissionService;  // REPLACES permissionPayloadValidator
  sender: ChannelSender;
  onPrompt?: OnPromptCallback;
}
```

### `handleCardAction` Simplification

Remove the existing validation/routing logic. Delegate entirely to `PermissionService`:

```typescript
async handleCardAction(event: CardActionEvent): Promise<void> {
  await this.permissionService.handleAction(event);
}
```

The `EngineImpl` constructor and private fields must also be updated:
- Remove `permissionPayloadValidator` field
- Add `permissionService` field

---

## 9. CardRenderPipeline SenderFactory Update

The pipeline already auto-subscribes to `CardStateStore.onChange()` in its constructor (line 62 of `CardRenderPipeline.ts`). The data flow is:

```
CardEngine.handleMessage()
  → cardStore.create() / cardStore.update()
    → CardStateStore fires onChange
      → CardRenderPipeline.enqueue(cardId, state)
        → renderer.render() → senderFactory(chatId).sendCard() / .updateCard()
```

Change `CardRenderPipeline` constructor to accept `SenderFactory` instead of `ChannelSender`:

```typescript
constructor(
  store: CardStateStoreImpl,
  renderer: CardRenderer,
  senderFactory: SenderFactory,    // CHANGED from ChannelSender
  correlationStore: MessageCorrelationStore,
)
```

In the `flush()` method, resolve the sender from the card's `chatId`:

```typescript
private async flush(entry: QueueEntry): Promise<void> {
  const sender = this.senderFactory(entry.state.chatId);
  // ... existing send logic using sender
}
```

**Note:** `CardState` already has a `chatId` field (from `CardStateStore.create()`).

---

## 10. atlas-cli Bootstrap

### `createApp.ts`

```typescript
import * as lark from '@larksuiteoapi/node-sdk';
import {
  CardStateStoreImpl, MessageCorrelationStoreImpl, SessionManagerImpl,
  CardRenderPipeline, CardEngineImpl, EngineImpl,
  ToolCardBuilderImpl, PermissionCardBuilderImpl, PermissionPayloadValidatorImpl,
  FeishuAdapter, FeishuChannelSender, FeishuCardRenderer,
  AgentBridge, PermissionService, SessionQueue,
} from 'atlas-gateway';
import { agentRegistry } from 'atlas-agent';
import type { AgentId, LarkClient, SenderFactory, CardActionEvent } from 'atlas-gateway';

export interface AppConfig {
  feishuAppId: string;
  feishuAppSecret: string;
  agentId: AgentId;
  cwd: string;
  dataDir?: string;
  env?: Record<string, string>;
}

export interface App {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createApp(config: AppConfig): App {
  // 1. Create Lark SDK client
  const larkClient: LarkClient = new lark.Client({
    appId: config.feishuAppId,
    appSecret: config.feishuAppSecret,
  }) as unknown as LarkClient;

  // 2. Create stores
  const cardStore = new CardStateStoreImpl();
  const correlationStore = new MessageCorrelationStoreImpl();
  const sessionManager = new SessionManagerImpl();

  // 3. Create sender factory + card renderer
  const cardRenderer = new FeishuCardRenderer();
  const senderFactory: SenderFactory = (chatId) =>
    new FeishuChannelSender(larkClient, chatId, cardRenderer);

  // 4. Create card render pipeline (auto-subscribes to cardStore.onChange)
  const pipeline = new CardRenderPipeline(cardStore, cardRenderer, senderFactory, correlationStore);

  // 5. Create card engine
  const toolCardBuilder = new ToolCardBuilderImpl();
  const permissionCardBuilder = new PermissionCardBuilderImpl();
  const cardEngine = new CardEngineImpl({
    cardStore,
    correlationStore,
    toolCardBuilder,
    permissionCardBuilder,
  });

  // 6. Create agent bridge
  const bridge = new AgentBridge({
    registry: agentRegistry,
    cardEngine,
    config: {
      agentId: config.agentId,
      cwd: config.cwd,
      env: config.env,
    },
  });

  // 7. Create permission service
  const permissionService = new PermissionService({
    validator: new PermissionPayloadValidatorImpl(),
    cardEngine,
    bridge,
  });

  // 8. Create command registry
  const commandRegistry = new CommandRegistryImpl(sessionManager);

  // 9. Create a default sender for Engine's direct use (commands etc.)
  // Uses a placeholder chatId — Engine.handleChannelEvent resolves the real chatId
  const defaultSender = senderFactory('__default__');

  // 10. Create engine
  const engine = new EngineImpl({
    cardStore,
    correlationStore,
    pipeline,
    cardEngine,
    sessionManager,
    commandRegistry,
    permissionService,
    sender: defaultSender,
    onPrompt: (session, event) => bridge.handlePrompt(session, event),
  });

  // 11. Create Feishu adapter
  const adapter = new FeishuAdapter({
    config: { appId: config.feishuAppId, appSecret: config.feishuAppSecret },
    larkClient,
    wsClientFactory: (appId, appSecret) =>
      new lark.WSClient({ appId, appSecret, loggerLevel: lark.LoggerLevel.warn }) as unknown as LarkWSClient,
    eventDispatcherFactory: (handlers) =>
      new lark.EventDispatcher({}).register(handlers),
    onCardAction: (event: CardActionEvent) => engine.handleCardAction(event),
  });

  return {
    async start() {
      await engine.start();
      await adapter.start((event) => engine.handleChannelEvent(event));
    },
    async stop() {
      await adapter.stop();
      await bridge.dispose();
      await engine.stop();
    },
  };
}
```

### `index.ts`

```typescript
import 'dotenv/config';
import { createApp } from './createApp.js';
import type { AgentId } from 'atlas-agent';

const app = createApp({
  feishuAppId: process.env.FEISHU_APP_ID!,
  feishuAppSecret: process.env.FEISHU_APP_SECRET!,
  agentId: (process.env.AGENT_ID ?? 'claude') as AgentId,
  cwd: process.env.AGENT_CWD ?? process.cwd(),
  env: process.env as Record<string, string>,
});

await app.start();

const shutdown = async () => {
  await app.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
```

---

## 11. End-to-End Data Flow

```
── Message Path ──────────────────────────────────────────

Feishu WS
  → FeishuAdapter.handleMessageEvent() [dedup, stale filter]
    → FeishuAdapter.toChannelEvent() [parse, strip mentions, set threadId from root_id]
      → handler(channelEvent)  [the MessageHandler callback]
        → Engine.handleChannelEvent(event)
          ├── /command → CommandRegistry → sender.sendText()
          └── onPrompt(session, event)
                → AgentBridge.handlePrompt()
                  → SessionQueue.enqueue(sessionKey, ...)
                    ├── getOrCreateAgent(session.sessionId, chatId)
                    │   ├── AgentRegistry.create(agentId, {cwd, env})
                    │   ├── agent.startSession()
                    │   └── agent.onMessage(handler)  ← BOUND ONCE
                    └── agent.sendPrompt(agentSessionId, text)

── Agent Streaming Path ──────────────────────────────────

AgentBackend.onMessage  [bound once at creation]
  → CardEngine.handleMessage(sessionId, chatId, msg)
    → cardStore.create() / cardStore.update()
      → CardStateStore.onChange fires
        → CardRenderPipeline.enqueue(cardId, state)
          → renderer.render(cardModel)
            → senderFactory(chatId).sendCard() / .updateCard()
              → FeishuChannelSender → Lark SDK → Feishu

── Permission Path ─────────────────────────────────────

Feishu WS card_action
  → FeishuAdapter.toCardActionEvent()
    → onCardAction(cardActionEvent)
      → Engine.handleCardAction()
        → PermissionService.handleAction(event)
          ├── PermissionPayloadValidator.validate(payload)
          ├── CardEngine.handlePermissionResponse()  [UI update only]
          └── AgentBridge.respondToPermission()
                → agent.respondToPermission?.(requestId, approved)
```

---

## 12. Testing Strategy

| Module | Test Focus |
|--------|-----------|
| `SessionQueue` | Serial execution guarantee, error isolation between keys, dispose cleanup, concurrent enqueue ordering |
| `AgentBridge` | Agent creation (once per session), onMessage binding (once per agent), prompt routing via queue, permission forwarding with optional guard, dispose cleanup |
| `PermissionService` | Validation delegation, invalid payload rejection, card UI update call, agent bridge notification, end-to-end flow |
| `FeishuAdapter` card actions | `toCardActionEvent()` mapping, null handling for missing fields, EventDispatcher registration of card action handler |
| `Engine` refactor | `handleCardAction` delegates to PermissionService, `EngineDeps` no longer has `permissionPayloadValidator` |
| `CardRenderPipeline` | SenderFactory integration — correct sender resolved per chatId |
| `createApp` | Smoke test: all deps wired, start/stop lifecycle, mocked Lark SDK |

All tests use mocked `AgentBackend`, `AgentRegistry`, `CardEngine`, `ChannelSender`.

---

## 13. Out of Scope (Phase 4+)

- Management API (health, metrics, session list)
- Express HTTP server (not needed — pure WebSocket)
- Multi-agent per session (agent switching)
- Multimodal message support (image/file/audio → agent)
- Persistent session resume across restarts
- Rate limiting / cron triggers
- Telegram / Discord / DingTalk adapters
