# Phase 3: Runtime Wiring Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the abstract card engine (Phase 2) to live agent backends and Feishu WebSocket, producing a working end-to-end system.

**Architecture:** AgentBridge manages agent lifecycle and routes AgentBackend.onMessage → CardEngine.handleMessage. SessionQueue ensures per-chat serial execution. PermissionService extracts permission business logic from Engine. CardRenderPipeline gains SenderFactory for per-chat sender resolution. atlas-cli bootstraps all deps via createApp().

**Tech Stack:** TypeScript 5.x strict ESM (NodeNext), Vitest, @larksuiteoapi/node-sdk (WSClient), atlas-agent, atlas-gateway, Zod

**Spec:** `docs/superpowers/specs/2026-03-31-atlas-ai-phase3-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/atlas-gateway/src/engine/SessionQueue.ts` | Per-key serial async queue |
| `packages/atlas-gateway/src/engine/SessionQueue.test.ts` | SessionQueue tests |
| `packages/atlas-gateway/src/engine/AgentBridge.ts` | Agent lifecycle + onMessage→CardEngine bridging |
| `packages/atlas-gateway/src/engine/AgentBridge.test.ts` | AgentBridge tests |
| `packages/atlas-gateway/src/engine/PermissionService.ts` | Permission validation + routing |
| `packages/atlas-gateway/src/engine/PermissionService.test.ts` | PermissionService tests |
| `packages/atlas-cli/src/createApp.ts` | App factory: wires all deps |
| `packages/atlas-cli/src/createApp.test.ts` | Smoke test with mocks |

### Modified Files

| File | Change |
|------|--------|
| `packages/atlas-gateway/src/channel/channelEvent.ts` | Add `threadId` field |
| `packages/atlas-gateway/src/channel/ChannelSender.ts` | Add `SenderFactory` type export |
| `packages/atlas-gateway/src/channel/feishu/FeishuAdapter.ts` | Add `onCardAction` + `toCardActionEvent()` + card action event registration |
| `packages/atlas-gateway/src/channel/feishu/FeishuAdapter.test.ts` | Tests for card action handling |
| `packages/atlas-gateway/src/engine/CardRenderPipeline.ts` | Accept `SenderFactory` instead of `ChannelSender` |
| `packages/atlas-gateway/src/engine/CardRenderPipeline.test.ts` | Update tests for SenderFactory |
| `packages/atlas-gateway/src/engine/Engine.ts` | Replace `permissionPayloadValidator` with `permissionService`; accept `senderFactory` |
| `packages/atlas-gateway/src/engine/Engine.test.ts` | Update Engine tests |
| `packages/atlas-gateway/src/engine/index.ts` | Export new modules |
| `packages/atlas-gateway/src/channel/feishu/index.ts` | Export `FeishuCardActionEvent` |
| `packages/atlas-cli/src/index.ts` | Replace stub with real bootstrap |
| `packages/atlas-cli/package.json` | Add dotenv dependency |

---

## Chunk 1: Foundation (SessionQueue + ChannelEvent threadId + SenderFactory)

### Task 1: SessionQueue

**Files:**
- Create: `packages/atlas-gateway/src/engine/SessionQueue.ts`
- Create: `packages/atlas-gateway/src/engine/SessionQueue.test.ts`

**Context:** Port from v1 `src/core/session/queue.ts`. Generic per-key serial async queue that chains promises. Each key runs tasks FIFO; different keys run in parallel.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/atlas-gateway/src/engine/SessionQueue.test.ts
import { describe, it, expect } from 'vitest';
import { SessionQueue, sessionKey } from './SessionQueue.js';

describe('SessionQueue', () => {
  it('runs tasks for the same key serially', async () => {
    const queue = new SessionQueue();
    const order: number[] = [];

    const task = (id: number, delayMs: number) => () =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          order.push(id);
          resolve();
        }, delayMs);
      });

    // Enqueue 3 tasks for the same key with decreasing delays
    // If parallel, order would be [3, 2, 1]. If serial, [1, 2, 3].
    const p1 = queue.enqueue('a', task(1, 30));
    const p2 = queue.enqueue('a', task(2, 20));
    const p3 = queue.enqueue('a', task(3, 10));
    await Promise.all([p1, p2, p3]);

    expect(order).toEqual([1, 2, 3]);
  });

  it('runs tasks for different keys in parallel', async () => {
    const queue = new SessionQueue();
    const order: string[] = [];

    const p1 = queue.enqueue('a', async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push('a');
    });
    const p2 = queue.enqueue('b', async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push('b');
    });
    await Promise.all([p1, p2]);

    // 'b' finishes first because it's shorter and runs in parallel
    expect(order).toEqual(['b', 'a']);
  });

  it('returns the task result', async () => {
    const queue = new SessionQueue();
    const result = await queue.enqueue('k', async () => 42);
    expect(result).toBe(42);
  });

  it('propagates task errors without blocking subsequent tasks', async () => {
    const queue = new SessionQueue();
    const order: number[] = [];

    const p1 = queue.enqueue('k', async () => {
      order.push(1);
      throw new Error('fail');
    });
    const p2 = queue.enqueue('k', async () => {
      order.push(2);
    });

    await expect(p1).rejects.toThrow('fail');
    await p2;
    expect(order).toEqual([1, 2]);
  });

  it('remove() clears a key', async () => {
    const queue = new SessionQueue();
    await queue.enqueue('k', async () => {});
    expect(queue.has('k')).toBe(true);
    queue.remove('k');
    expect(queue.has('k')).toBe(false);
  });

  it('dispose() clears all keys', async () => {
    const queue = new SessionQueue();
    await queue.enqueue('a', async () => {});
    await queue.enqueue('b', async () => {});
    queue.dispose();
    expect(queue.has('a')).toBe(false);
    expect(queue.has('b')).toBe(false);
  });
});

describe('sessionKey', () => {
  it('returns chatId for events without threadId', () => {
    const event = {
      channelId: 'feishu',
      chatId: 'chat_123',
      userId: 'u1',
      userName: '',
      messageId: 'm1',
      content: { type: 'text' as const, text: 'hello' },
      timestamp: Date.now(),
    };
    expect(sessionKey(event)).toBe('chat_123');
  });

  it('returns chatId:threadId for events with threadId', () => {
    const event = {
      channelId: 'feishu',
      chatId: 'chat_123',
      userId: 'u1',
      userName: '',
      messageId: 'm1',
      threadId: 'thread_456',
      content: { type: 'text' as const, text: 'hello' },
      timestamp: Date.now(),
    };
    expect(sessionKey(event)).toBe('chat_123:thread_456');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/atlas-gateway && npx vitest run src/engine/SessionQueue.test.ts`
Expected: FAIL — module `./SessionQueue.js` not found

- [ ] **Step 3: Implement SessionQueue**

```typescript
// packages/atlas-gateway/src/engine/SessionQueue.ts
import type { ChannelEvent } from '../channel/channelEvent.js';

/**
 * Per-key serial async queue.
 * Tasks for the same key execute FIFO, one at a time.
 * Tasks for different keys execute in parallel.
 */
export class SessionQueue {
  private queues = new Map<string, Promise<void>>();

  async enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(key) ?? Promise.resolve();

    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const result = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const chain = prev.then(async () => {
      try {
        resolve(await task());
      } catch (err) {
        reject(err);
      }
    });

    // Store the chain but swallow rejections — they're delivered via `result`.
    this.queues.set(key, chain.catch(() => {}));

    return result;
  }

  has(key: string): boolean {
    return this.queues.has(key);
  }

  remove(key: string): void {
    this.queues.delete(key);
  }

  dispose(): void {
    this.queues.clear();
  }
}

/**
 * Derive a session queue key from a ChannelEvent.
 * 1:1 chats use chatId. Group threads use chatId:threadId.
 */
export function sessionKey(event: Pick<ChannelEvent, 'chatId' | 'threadId'>): string {
  return event.threadId ? `${event.chatId}:${event.threadId}` : event.chatId;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/atlas-gateway && npx vitest run src/engine/SessionQueue.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
cd packages/atlas-gateway
git add src/engine/SessionQueue.ts src/engine/SessionQueue.test.ts
git commit -m "feat(gateway): add SessionQueue for per-session serial execution"
```

---

### Task 2: Add threadId to ChannelEvent schema

**Files:**
- Modify: `packages/atlas-gateway/src/channel/channelEvent.ts`
- Modify: `packages/atlas-gateway/src/channel/feishu/FeishuAdapter.ts` (toChannelEvent method)
- Modify: `packages/atlas-gateway/src/channel/feishu/FeishuAdapter.test.ts` (add threadId test)

**Context:** The existing `ChannelEventSchema` (channelEvent.ts) has `channelId`, `chatId`, `userId`, `userName`, `messageId`, `content`, `timestamp`, `replyToId`. We add `threadId` for group thread support. In Feishu, this maps to `message.root_id` when the message is a reply within a thread.

- [ ] **Step 1: Write the failing test for threadId in toChannelEvent**

Add to `FeishuAdapter.test.ts`, in the `toChannelEvent` describe block:

```typescript
it('sets threadId from root_id when present and different from message_id', () => {
  const adapter = createAdapter();
  const data: FeishuMessageEvent = {
    sender: { sender_id: { open_id: 'u1' }, sender_type: 'user' },
    message: {
      message_id: 'msg_reply',
      root_id: 'msg_root',
      parent_id: 'msg_parent',
      create_time: String(Date.now()),
      chat_id: 'chat_1',
      chat_type: 'group',
      message_type: 'text',
      content: JSON.stringify({ text: 'reply in thread' }),
    },
  };
  const event = adapter.toChannelEvent(data);
  expect(event).not.toBeNull();
  expect(event!.threadId).toBe('msg_root');
});

it('does not set threadId when root_id equals message_id', () => {
  const adapter = createAdapter();
  const data: FeishuMessageEvent = {
    sender: { sender_id: { open_id: 'u1' }, sender_type: 'user' },
    message: {
      message_id: 'msg_root',
      root_id: 'msg_root',
      create_time: String(Date.now()),
      chat_id: 'chat_1',
      chat_type: 'group',
      message_type: 'text',
      content: JSON.stringify({ text: 'thread root' }),
    },
  };
  const event = adapter.toChannelEvent(data);
  expect(event).not.toBeNull();
  expect(event!.threadId).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/atlas-gateway && npx vitest run src/channel/feishu/FeishuAdapter.test.ts -t "threadId"`
Expected: FAIL — `threadId` not in type or value

- [ ] **Step 3: Add threadId to ChannelEvent schema**

In `packages/atlas-gateway/src/channel/channelEvent.ts`, add after line 8 (`messageId`):

```typescript
  threadId: z.string().optional(),
```

- [ ] **Step 4: Populate threadId in FeishuAdapter.toChannelEvent()**

In `packages/atlas-gateway/src/channel/feishu/FeishuAdapter.ts`, in the `toChannelEvent` method, before the `return` statement (around line 508), add `threadId` to the returned object:

```typescript
    // Derive threadId from root_id (thread root message)
    const threadId = message.root_id && message.root_id !== message.message_id
      ? message.root_id
      : undefined;

    return {
      channelId: 'feishu',
      chatId,
      userId,
      userName,
      messageId,
      threadId,    // NEW
      content,
      timestamp,
      replyToId: message.parent_id,
    };
```

- [ ] **Step 5: Run all tests to verify they pass**

Run: `cd packages/atlas-gateway && npx vitest run`
Expected: All tests PASS (including new threadId tests)

- [ ] **Step 6: Commit**

```bash
cd packages/atlas-gateway
git add src/channel/channelEvent.ts src/channel/feishu/FeishuAdapter.ts src/channel/feishu/FeishuAdapter.test.ts
git commit -m "feat(gateway): add threadId to ChannelEvent for group thread support"
```

---

### Task 3: Add SenderFactory type + refactor CardRenderPipeline

**Files:**
- Modify: `packages/atlas-gateway/src/channel/ChannelSender.ts`
- Modify: `packages/atlas-gateway/src/engine/CardRenderPipeline.ts`
- Modify: `packages/atlas-gateway/src/engine/CardRenderPipeline.test.ts` (if exists, else tests embedded in other test files)

**Context:** `FeishuChannelSender` requires `chatId` at construction (it's per-chat). `CardRenderPipeline` currently takes a single `ChannelSender`. We need a `SenderFactory` so the pipeline resolves the correct sender per card's `chatId`. `CardState` already has a `chatId` field.

- [ ] **Step 1: Add SenderFactory type to ChannelSender.ts**

In `packages/atlas-gateway/src/channel/ChannelSender.ts`, add at the end:

```typescript
/**
 * Factory that creates a ChannelSender scoped to a specific chat.
 * Used by CardRenderPipeline to resolve senders per card.
 */
export type SenderFactory = (chatId: string) => ChannelSender;
```

- [ ] **Step 2: Check if CardRenderPipeline has existing tests**

Run: `ls packages/atlas-gateway/src/engine/CardRenderPipeline.test.ts 2>/dev/null || echo "no test file"`

If no test file exists, we'll create one. If it exists, we'll modify it.

- [ ] **Step 3: Write the failing test for SenderFactory**

Create or modify `packages/atlas-gateway/src/engine/CardRenderPipeline.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { CardRenderPipeline } from './CardRenderPipeline.js';
import type { CardRenderer } from './CardRenderPipeline.js';
import type { CardState, CardStateStoreImpl } from './CardStateStore.js';
import type { MessageCorrelationStore } from './MessageCorrelationStore.js';
import type { ChannelSender, SenderFactory } from '../channel/ChannelSender.js';
import type { CardModel } from '../cards/CardModel.js';

function createMockSender(): ChannelSender {
  return {
    sendText: vi.fn().mockResolvedValue('msg_1'),
    sendMarkdown: vi.fn().mockResolvedValue('msg_1'),
    sendCard: vi.fn().mockResolvedValue('msg_1'),
    updateCard: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockRenderer(): CardRenderer {
  return {
    render: vi.fn().mockImplementation((card: CardModel) => card),
  };
}

function createMockCorrelationStore(): MessageCorrelationStore {
  return {
    setMessageId: vi.fn(),
  } as unknown as MessageCorrelationStore;
}

describe('CardRenderPipeline with SenderFactory', () => {
  it('resolves sender per chatId from card state', async () => {
    const senderA = createMockSender();
    const senderB = createMockSender();
    const senderFactory: SenderFactory = vi.fn().mockImplementation((chatId: string) => {
      return chatId === 'chat_a' ? senderA : senderB;
    });

    const renderer = createMockRenderer();
    const correlationStore = createMockCorrelationStore();

    // Create a minimal mock store that triggers onChange
    let changeHandler: ((cardId: string, state: CardState) => void) | null = null;
    const mockStore = {
      onChange: vi.fn().mockImplementation((handler: (cardId: string, state: CardState) => void) => {
        changeHandler = handler;
        return () => { changeHandler = null; };
      }),
      get: vi.fn().mockReturnValue(null),
      setMessageId: vi.fn(),
    } as unknown as CardStateStoreImpl;

    const pipeline = new CardRenderPipeline(mockStore, renderer, senderFactory, correlationStore);

    // Simulate a card state change for chat_a
    const cardState: CardState = {
      cardId: 'card_1',
      messageId: null,
      chatId: 'chat_a',
      type: 'streaming',
      status: 'active',
      content: { header: { title: 'Test', status: 'active', icon: '' }, sections: [], actions: [], fields: [] },
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {},
    };

    // Trigger onChange
    changeHandler!(cardState.cardId, cardState);

    // Wait for async processing
    await new Promise((r) => setTimeout(r, 50));

    expect(senderFactory).toHaveBeenCalledWith('chat_a');
    expect(senderA.sendCard).toHaveBeenCalled();
    expect(senderB.sendCard).not.toHaveBeenCalled();

    pipeline.dispose();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd packages/atlas-gateway && npx vitest run src/engine/CardRenderPipeline.test.ts`
Expected: FAIL — constructor signature mismatch (still expects `ChannelSender` not `SenderFactory`)

- [ ] **Step 5: Refactor CardRenderPipeline to use SenderFactory**

In `packages/atlas-gateway/src/engine/CardRenderPipeline.ts`:

1. Change import: add `SenderFactory` import from `../channel/ChannelSender.js`
2. Change constructor parameter from `sender: ChannelSender` to `senderFactory: SenderFactory`
3. Change private field from `private readonly sender: ChannelSender` to `private readonly senderFactory: SenderFactory`
4. In the `send()` method (line 154), resolve the sender from the card's chatId:

Replace:
```typescript
  private async send(entry: QueueEntry): Promise<void> {
    const { cardId, state } = entry;

    const rendered = this.renderer.render(state.content, {
      status: state.status,
      type: state.type,
    });

    // Re-read messageId from the store (it may have been set by a prior send).
    const latestState = this.store.get(cardId);
    const messageId = latestState?.messageId ?? state.messageId;

    if (messageId) {
      // Card already has a message — update (PATCH).
      await this.sender.updateCard(messageId, rendered);
    } else {
      // Card is new — send and record the messageId.
      const newMessageId = await this.sender.sendCard(rendered);
      this.correlationStore.setMessageId(cardId, newMessageId);
      this.store.setMessageId(cardId, newMessageId);
    }
  }
```

With:
```typescript
  private async send(entry: QueueEntry): Promise<void> {
    const { cardId, state } = entry;

    const rendered = this.renderer.render(state.content, {
      status: state.status,
      type: state.type,
    });

    // Resolve sender for this card's chat
    const sender = this.senderFactory(state.chatId);

    // Re-read messageId from the store (it may have been set by a prior send).
    const latestState = this.store.get(cardId);
    const messageId = latestState?.messageId ?? state.messageId;

    if (messageId) {
      await sender.updateCard(messageId, rendered);
    } else {
      const newMessageId = await sender.sendCard(rendered);
      this.correlationStore.setMessageId(cardId, newMessageId);
      this.store.setMessageId(cardId, newMessageId);
    }
  }
```

- [ ] **Step 6: Run all tests to verify they pass**

Run: `cd packages/atlas-gateway && npx vitest run`
Expected: All tests PASS. If any existing tests break because they pass a `ChannelSender` instead of `SenderFactory`, update them to wrap: `const senderFactory = () => mockSender;`

- [ ] **Step 7: Commit**

```bash
cd packages/atlas-gateway
git add src/channel/ChannelSender.ts src/engine/CardRenderPipeline.ts src/engine/CardRenderPipeline.test.ts
git commit -m "feat(gateway): add SenderFactory and refactor CardRenderPipeline for per-chat sender resolution"
```

---

## Chunk 2: AgentBridge + PermissionService

### Task 4: AgentBridge

**Files:**
- Create: `packages/atlas-gateway/src/engine/AgentBridge.ts`
- Create: `packages/atlas-gateway/src/engine/AgentBridge.test.ts`

**Context:** AgentBridge implements the `OnPromptCallback` signature. It manages a `Map<sessionId, ManagedAgentSession>` where each entry holds an `AgentBackend` instance, the agent's `sessionId` from `startSession()`, and the bound `onMessage` handler. Uses `SessionQueue` for per-chat serial execution.

Key interfaces from atlas-agent:
- `AgentBackend`: `startSession() → {sessionId}`, `sendPrompt(sessionId, text)`, `onMessage(handler)`, `offMessage?(handler)`, `respondToPermission?(requestId, approved)`, `dispose()`
- `AgentRegistry`: `create(id, {cwd, env}) → AgentBackend`
- `AgentMessageHandler`: `(msg: AgentMessage) => void`

Key interfaces from atlas-gateway:
- `SessionInfo`: `{ sessionId, chatId, agentId, ... }`
- `OnPromptCallback`: `(session: SessionInfo, event: ChannelEvent) => Promise<void>`
- `CardEngineImpl`: `handleMessage(sessionId, chatId, msg)`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/atlas-gateway/src/engine/AgentBridge.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentBridge } from './AgentBridge.js';
import type { AgentBackend, AgentMessageHandler, AgentRegistry, AgentMessage } from 'atlas-agent';
import type { CardEngineImpl } from './CardEngine.js';
import type { SessionInfo } from './SessionManager.js';
import type { ChannelEvent } from '../channel/channelEvent.js';

function createMockAgent(): AgentBackend & {
  _handlers: AgentMessageHandler[];
  _simulateMessage: (msg: AgentMessage) => void;
} {
  const handlers: AgentMessageHandler[] = [];
  return {
    _handlers: handlers,
    _simulateMessage: (msg: AgentMessage) => {
      for (const h of handlers) h(msg);
    },
    startSession: vi.fn().mockResolvedValue({ sessionId: 'agent_session_1' }),
    sendPrompt: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    onMessage: vi.fn().mockImplementation((handler: AgentMessageHandler) => {
      handlers.push(handler);
    }),
    offMessage: vi.fn().mockImplementation((handler: AgentMessageHandler) => {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    }),
    respondToPermission: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockRegistry(agent: AgentBackend): AgentRegistry {
  return {
    create: vi.fn().mockReturnValue(agent),
    register: vi.fn(),
    has: vi.fn().mockReturnValue(true),
    list: vi.fn().mockReturnValue(['claude']),
  } as unknown as AgentRegistry;
}

function createMockCardEngine(): CardEngineImpl {
  return {
    handleMessage: vi.fn(),
    handlePermissionResponse: vi.fn(),
    getStreamingState: vi.fn(),
    dispose: vi.fn(),
  } as unknown as CardEngineImpl;
}

function createEvent(overrides?: Partial<ChannelEvent>): ChannelEvent {
  return {
    channelId: 'feishu',
    chatId: 'chat_1',
    userId: 'user_1',
    userName: 'Test User',
    messageId: 'msg_1',
    content: { type: 'text', text: 'Hello agent' },
    timestamp: Date.now(),
    ...overrides,
  };
}

function createSession(overrides?: Partial<SessionInfo>): SessionInfo {
  return {
    sessionId: 'session_1',
    chatId: 'chat_1',
    agentId: 'claude',
    permissionMode: 'default',
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    ...overrides,
  };
}

describe('AgentBridge', () => {
  let agent: ReturnType<typeof createMockAgent>;
  let registry: AgentRegistry;
  let cardEngine: CardEngineImpl;
  let bridge: AgentBridge;

  beforeEach(() => {
    agent = createMockAgent();
    registry = createMockRegistry(agent);
    cardEngine = createMockCardEngine();
    bridge = new AgentBridge({
      registry,
      cardEngine,
      config: { agentId: 'claude', cwd: '/tmp' },
    });
  });

  describe('handlePrompt', () => {
    it('creates agent and starts session on first prompt', async () => {
      await bridge.handlePrompt(createSession(), createEvent());

      expect(registry.create).toHaveBeenCalledWith('claude', { cwd: '/tmp', env: undefined });
      expect(agent.startSession).toHaveBeenCalled();
      expect(agent.onMessage).toHaveBeenCalledTimes(1);
      expect(agent.sendPrompt).toHaveBeenCalledWith('agent_session_1', 'Hello agent');
    });

    it('reuses existing agent on subsequent prompts', async () => {
      const session = createSession();
      await bridge.handlePrompt(session, createEvent());
      await bridge.handlePrompt(session, createEvent({ messageId: 'msg_2', content: { type: 'text', text: 'Second' } }));

      expect(registry.create).toHaveBeenCalledTimes(1); // only once
      expect(agent.startSession).toHaveBeenCalledTimes(1); // only once
      expect(agent.onMessage).toHaveBeenCalledTimes(1); // bound once
      expect(agent.sendPrompt).toHaveBeenCalledTimes(2);
      expect(agent.sendPrompt).toHaveBeenLastCalledWith('agent_session_1', 'Second');
    });

    it('skips non-text messages', async () => {
      await bridge.handlePrompt(
        createSession(),
        createEvent({ content: { type: 'image', url: 'img_key', mimeType: 'image/png' } }),
      );

      // Agent should be created but sendPrompt should NOT be called (empty text)
      expect(agent.sendPrompt).not.toHaveBeenCalled();
    });

    it('routes agent messages to CardEngine', async () => {
      await bridge.handlePrompt(createSession(), createEvent());

      const msg: AgentMessage = { type: 'model-output', textDelta: 'Hello' };
      agent._simulateMessage(msg);

      expect(cardEngine.handleMessage).toHaveBeenCalledWith('session_1', 'chat_1', msg);
    });
  });

  describe('respondToPermission', () => {
    it('forwards to agent.respondToPermission', async () => {
      await bridge.handlePrompt(createSession(), createEvent());
      await bridge.respondToPermission('session_1', 'req_1', true);

      expect(agent.respondToPermission).toHaveBeenCalledWith('req_1', true);
    });

    it('no-ops for unknown session', async () => {
      await bridge.respondToPermission('nonexistent', 'req_1', true);
      expect(agent.respondToPermission).not.toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('disposes all agents', async () => {
      await bridge.handlePrompt(createSession(), createEvent());
      await bridge.dispose();

      expect(agent.offMessage).toHaveBeenCalled();
      expect(agent.dispose).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/atlas-gateway && npx vitest run src/engine/AgentBridge.test.ts`
Expected: FAIL — module `./AgentBridge.js` not found

- [ ] **Step 3: Implement AgentBridge**

```typescript
// packages/atlas-gateway/src/engine/AgentBridge.ts
import type {
  AgentBackend,
  AgentId,
  AgentMessage,
  AgentMessageHandler,
  AgentRegistry,
} from 'atlas-agent';
import type { CardEngineImpl } from './CardEngine.js';
import type { SessionInfo } from './SessionManager.js';
import type { ChannelEvent } from '../channel/channelEvent.js';
import { SessionQueue, sessionKey } from './SessionQueue.js';

// ── Types ──────────────────────────────────────────────────────────────────

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

interface ManagedAgentSession {
  agent: AgentBackend;
  agentSessionId: string;
  handler: AgentMessageHandler;
}

// ── Implementation ─────────────────────────────────────────────────────────

export class AgentBridge {
  private readonly registry: AgentRegistry;
  private readonly cardEngine: CardEngineImpl;
  private readonly config: AgentBridgeConfig;
  private readonly queue = new SessionQueue();
  private readonly sessions = new Map<string, ManagedAgentSession>();

  constructor(deps: AgentBridgeDeps) {
    this.registry = deps.registry;
    this.cardEngine = deps.cardEngine;
    this.config = deps.config;
  }

  /**
   * OnPromptCallback implementation.
   * Called by Engine when a user sends a message that isn't a command.
   */
  async handlePrompt(session: SessionInfo, event: ChannelEvent): Promise<void> {
    const key = sessionKey(event);

    await this.queue.enqueue(key, async () => {
      const text = event.content.type === 'text' ? event.content.text : '';
      if (!text) return; // Skip non-text messages

      const managed = await this.getOrCreateAgent(session.sessionId, event.chatId);
      await managed.agent.sendPrompt(managed.agentSessionId, text);
    });
  }

  /**
   * Called by PermissionService when user approves/denies a permission request.
   */
  async respondToPermission(
    sessionId: string,
    requestId: string,
    approved: boolean,
  ): Promise<void> {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;

    if (managed.agent.respondToPermission) {
      await managed.agent.respondToPermission(requestId, approved);
    }
  }

  /**
   * Dispose a single session's agent.
   */
  async disposeSession(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;

    if (managed.agent.offMessage) {
      managed.agent.offMessage(managed.handler);
    }
    await managed.agent.dispose();
    this.sessions.delete(sessionId);
  }

  /**
   * Dispose all agents and the queue.
   */
  async dispose(): Promise<void> {
    const entries = Array.from(this.sessions.keys());
    for (const sessionId of entries) {
      await this.disposeSession(sessionId);
    }
    this.queue.dispose();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async getOrCreateAgent(
    sessionId: string,
    chatId: string,
  ): Promise<ManagedAgentSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    // Create agent backend via registry
    const agent = this.registry.create(this.config.agentId, {
      cwd: this.config.cwd,
      env: this.config.env,
    });

    // Start agent session
    const { sessionId: agentSessionId } = await agent.startSession();

    // Bind onMessage ONCE — routes all agent messages to CardEngine
    const handler: AgentMessageHandler = (msg: AgentMessage) => {
      this.cardEngine.handleMessage(sessionId, chatId, msg);
    };
    agent.onMessage(handler);

    const managed: ManagedAgentSession = { agent, agentSessionId, handler };
    this.sessions.set(sessionId, managed);

    return managed;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/atlas-gateway && npx vitest run src/engine/AgentBridge.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
cd packages/atlas-gateway
git add src/engine/AgentBridge.ts src/engine/AgentBridge.test.ts
git commit -m "feat(gateway): add AgentBridge for agent lifecycle and message bridging"
```

---

### Task 5: PermissionService

**Files:**
- Create: `packages/atlas-gateway/src/engine/PermissionService.ts`
- Create: `packages/atlas-gateway/src/engine/PermissionService.test.ts`

**Context:** Extracts permission business logic from Engine. Flow: validate payload → update card UI → notify agent. Uses `PermissionPayloadValidatorImpl` from `PermissionCard.ts` and `AgentBridge.respondToPermission()`.

Key types:
- `CardActionEvent`: `{ messageId, chatId, userId, value: Record<string, unknown> }` (from Engine.ts)
- `PermissionActionPayload`: validated by `PermissionPayloadValidatorImpl.validate()` → `{ ok, data?, error? }`
- `PermissionActionPayload.data` has: `sessionId`, `requestId` (the `nonce`), `action` ('allow' | 'deny' | 'allow_all')

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/atlas-gateway/src/engine/PermissionService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PermissionService } from './PermissionService.js';
import type { PermissionPayloadValidatorImpl, PermissionActionPayload } from './PermissionCard.js';
import type { CardEngineImpl } from './CardEngine.js';
import type { AgentBridge } from './AgentBridge.js';
import type { CardActionEvent } from './Engine.js';

function createMockValidator(result: { ok: true; data: PermissionActionPayload } | { ok: false; error: string }) {
  return {
    validate: vi.fn().mockReturnValue(result),
  } as unknown as PermissionPayloadValidatorImpl;
}

function createMockCardEngine() {
  return {
    handlePermissionResponse: vi.fn(),
  } as unknown as CardEngineImpl;
}

function createMockBridge() {
  return {
    respondToPermission: vi.fn().mockResolvedValue(undefined),
  } as unknown as AgentBridge;
}

describe('PermissionService', () => {
  let cardEngine: ReturnType<typeof createMockCardEngine>;
  let bridge: ReturnType<typeof createMockBridge>;

  beforeEach(() => {
    cardEngine = createMockCardEngine();
    bridge = createMockBridge();
  });

  it('validates, updates card UI, and notifies agent on valid payload', async () => {
    const payload: PermissionActionPayload = {
      v: 1,
      sessionId: 'session_1',
      nonce: 'req_1',
      action: 'allow',
      timestamp: Date.now(),
    } as unknown as PermissionActionPayload;

    const validator = createMockValidator({ ok: true, data: payload });
    const service = new PermissionService({ validator, cardEngine, bridge });

    const event: CardActionEvent = {
      messageId: 'msg_1',
      chatId: 'chat_1',
      userId: 'user_1',
      value: payload as unknown as Record<string, unknown>,
    };

    await service.handleAction(event);

    expect(validator.validate).toHaveBeenCalledWith(event.value);
    expect(cardEngine.handlePermissionResponse).toHaveBeenCalledWith('session_1', payload);
    expect(bridge.respondToPermission).toHaveBeenCalledWith('session_1', 'req_1', true);
  });

  it('maps deny action to approved=false', async () => {
    const payload = {
      v: 1,
      sessionId: 'session_1',
      nonce: 'req_1',
      action: 'deny',
      timestamp: Date.now(),
    } as unknown as PermissionActionPayload;

    const validator = createMockValidator({ ok: true, data: payload });
    const service = new PermissionService({ validator, cardEngine, bridge });

    await service.handleAction({
      messageId: 'msg_1', chatId: 'chat_1', userId: 'user_1',
      value: payload as unknown as Record<string, unknown>,
    });

    expect(bridge.respondToPermission).toHaveBeenCalledWith('session_1', 'req_1', false);
  });

  it('maps allow_all action to approved=true', async () => {
    const payload = {
      v: 1,
      sessionId: 'session_1',
      nonce: 'req_1',
      action: 'allow_all',
      timestamp: Date.now(),
    } as unknown as PermissionActionPayload;

    const validator = createMockValidator({ ok: true, data: payload });
    const service = new PermissionService({ validator, cardEngine, bridge });

    await service.handleAction({
      messageId: 'msg_1', chatId: 'chat_1', userId: 'user_1',
      value: payload as unknown as Record<string, unknown>,
    });

    expect(bridge.respondToPermission).toHaveBeenCalledWith('session_1', 'req_1', true);
  });

  it('ignores invalid payloads', async () => {
    const validator = createMockValidator({ ok: false, error: 'Invalid nonce' });
    const service = new PermissionService({ validator, cardEngine, bridge });

    await service.handleAction({
      messageId: 'msg_1', chatId: 'chat_1', userId: 'user_1',
      value: { garbage: true },
    });

    expect(cardEngine.handlePermissionResponse).not.toHaveBeenCalled();
    expect(bridge.respondToPermission).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/atlas-gateway && npx vitest run src/engine/PermissionService.test.ts`
Expected: FAIL — module `./PermissionService.js` not found

- [ ] **Step 3: Implement PermissionService**

First, check the actual `PermissionActionPayload` type to see field names:

Read: `packages/atlas-gateway/src/engine/PermissionCard.ts` — look for the `PermissionActionPayloadSchema` and `PermissionActionPayload` type to find exact field names (`sessionId`, `nonce`, `action`, etc.)

```typescript
// packages/atlas-gateway/src/engine/PermissionService.ts
import type { CardActionEvent } from './Engine.js';
import type { PermissionPayloadValidatorImpl, PermissionActionPayload } from './PermissionCard.js';
import type { CardEngineImpl } from './CardEngine.js';
import type { AgentBridge } from './AgentBridge.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface PermissionServiceDeps {
  validator: PermissionPayloadValidatorImpl;
  cardEngine: CardEngineImpl;
  bridge: AgentBridge;
}

// ── Implementation ─────────────────────────────────────────────────────────

export class PermissionService {
  private readonly validator: PermissionPayloadValidatorImpl;
  private readonly cardEngine: CardEngineImpl;
  private readonly bridge: AgentBridge;

  constructor(deps: PermissionServiceDeps) {
    this.validator = deps.validator;
    this.cardEngine = deps.cardEngine;
    this.bridge = deps.bridge;
  }

  /**
   * Handle a card action event containing a permission response.
   * 1. Validate the payload
   * 2. Update the card UI via CardEngine
   * 3. Notify the agent via AgentBridge
   */
  async handleAction(event: CardActionEvent): Promise<void> {
    const result = this.validator.validate(
      event.value as unknown as PermissionActionPayload,
    );

    if (!result.ok) {
      // Invalid payload — log and ignore
      console.error('[PermissionService] Invalid payload:', result.error);
      return;
    }

    const payload = result.data;

    // Update card UI (show approved/denied state)
    this.cardEngine.handlePermissionResponse(payload.sessionId, payload);

    // Notify agent backend
    const approved = payload.action !== 'deny';
    await this.bridge.respondToPermission(payload.sessionId, payload.nonce, approved);
  }
}
```

**Note:** The exact field names on `PermissionActionPayload` (`sessionId`, `nonce`, `action`) must match the actual schema. The implementer should read `PermissionCard.ts` lines defining `PermissionActionPayloadSchema` and adjust field names accordingly.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/atlas-gateway && npx vitest run src/engine/PermissionService.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
cd packages/atlas-gateway
git add src/engine/PermissionService.ts src/engine/PermissionService.test.ts
git commit -m "feat(gateway): add PermissionService for permission business logic"
```

---

## Chunk 3: FeishuAdapter Card Actions + Engine Refactor + Barrel Exports

### Task 6: FeishuAdapter card action support

**Files:**
- Modify: `packages/atlas-gateway/src/channel/feishu/FeishuAdapter.ts`
- Modify: `packages/atlas-gateway/src/channel/feishu/FeishuAdapter.test.ts`

**Context:** The adapter currently registers only `im.message.receive_v1` in the EventDispatcher. We add `card.action.trigger` to handle card button clicks. A new `onCardAction` callback is added to the constructor opts. `FeishuCardActionEvent` type already exists (lines 98-104).

- [ ] **Step 1: Write the failing tests for card action handling**

Add to `FeishuAdapter.test.ts`:

```typescript
describe('card action handling', () => {
  it('registers card.action.trigger in EventDispatcher', async () => {
    let registeredHandlers: Record<string, unknown> = {};
    const adapter = new FeishuAdapter({
      config: { appId: 'id', appSecret: 'secret' },
      larkClient: createMockLarkClient(),
      eventDispatcherFactory: (handlers) => {
        registeredHandlers = handlers;
        return {};
      },
      wsClientFactory: (id, secret) => ({ start: vi.fn().mockResolvedValue(undefined), close: vi.fn() }),
      onCardAction: vi.fn(),
    });

    await adapter.start(vi.fn());
    expect(registeredHandlers).toHaveProperty('card.action.trigger');
  });

  it('converts FeishuCardActionEvent to CardActionEvent and calls onCardAction', async () => {
    const onCardAction = vi.fn().mockResolvedValue(undefined);
    let cardActionHandler: ((data: unknown) => Promise<unknown>) | undefined;

    const adapter = new FeishuAdapter({
      config: { appId: 'id', appSecret: 'secret' },
      larkClient: createMockLarkClient(),
      eventDispatcherFactory: (handlers) => {
        cardActionHandler = handlers['card.action.trigger'] as (data: unknown) => Promise<unknown>;
        return {};
      },
      wsClientFactory: (id, secret) => ({ start: vi.fn().mockResolvedValue(undefined), close: vi.fn() }),
      onCardAction,
    });

    await adapter.start(vi.fn());

    // Simulate card action event
    await cardActionHandler!({
      operator: { open_id: 'user_1' },
      action: { value: { sessionId: 's1', action: 'allow' }, tag: 'button' },
      open_message_id: 'msg_1',
      open_chat_id: 'chat_1',
    });

    expect(onCardAction).toHaveBeenCalledWith({
      messageId: 'msg_1',
      chatId: 'chat_1',
      userId: 'user_1',
      value: { sessionId: 's1', action: 'allow' },
    });
  });

  it('ignores card action with missing fields', async () => {
    const onCardAction = vi.fn();
    let cardActionHandler: ((data: unknown) => Promise<unknown>) | undefined;

    const adapter = new FeishuAdapter({
      config: { appId: 'id', appSecret: 'secret' },
      larkClient: createMockLarkClient(),
      eventDispatcherFactory: (handlers) => {
        cardActionHandler = handlers['card.action.trigger'] as (data: unknown) => Promise<unknown>;
        return {};
      },
      wsClientFactory: (id, secret) => ({ start: vi.fn().mockResolvedValue(undefined), close: vi.fn() }),
      onCardAction,
    });

    await adapter.start(vi.fn());

    // Missing open_chat_id
    await cardActionHandler!({
      operator: { open_id: 'user_1' },
      action: { value: { sessionId: 's1' } },
      open_message_id: 'msg_1',
    });

    expect(onCardAction).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/atlas-gateway && npx vitest run src/channel/feishu/FeishuAdapter.test.ts -t "card action"`
Expected: FAIL — `onCardAction` not in constructor type

- [ ] **Step 3: Add onCardAction to FeishuAdapter**

In `FeishuAdapter.ts`:

1. Add `onCardAction` to constructor opts type (after `renderer?`):
```typescript
  onCardAction?: (event: import('../../engine/Engine.js').CardActionEvent) => Promise<void>;
```

2. Store it as a private field:
```typescript
  private readonly onCardAction?: (event: import('../../engine/Engine.js').CardActionEvent) => Promise<void>;
```

3. In constructor body, add:
```typescript
  this.onCardAction = opts.onCardAction;
```

4. In `start()` method, add `card.action.trigger` to the handlers object:
```typescript
  'card.action.trigger': async (data: unknown) => {
    try {
      const cardEvent = this.toCardActionEvent(data as FeishuCardActionEvent);
      if (cardEvent && this.onCardAction) {
        await this.onCardAction(cardEvent);
      }
    } catch (err) {
      log('error', 'Error handling card action', { error: String(err) });
    }
  },
```

5. Add the `toCardActionEvent` method:
```typescript
  toCardActionEvent(data: FeishuCardActionEvent): CardActionEvent | null {
    const messageId = data.open_message_id;
    const chatId = data.open_chat_id;
    const userId = data.operator?.open_id;
    const value = data.action?.value;
    if (!messageId || !chatId || !userId || !value || typeof value !== 'object') return null;
    return { messageId, chatId, userId, value: value as Record<string, unknown> };
  }
```

Import `CardActionEvent` type at the top of the file.

- [ ] **Step 4: Run all tests to verify they pass**

Run: `cd packages/atlas-gateway && npx vitest run src/channel/feishu/FeishuAdapter.test.ts`
Expected: All tests PASS (existing + new card action tests)

- [ ] **Step 5: Commit**

```bash
cd packages/atlas-gateway
git add src/channel/feishu/FeishuAdapter.ts src/channel/feishu/FeishuAdapter.test.ts
git commit -m "feat(gateway): add card action support to FeishuAdapter"
```

---

### Task 7: Refactor Engine to use PermissionService

**Files:**
- Modify: `packages/atlas-gateway/src/engine/Engine.ts`
- Modify: `packages/atlas-gateway/src/engine/Engine.test.ts` (if exists)

**Context:** Replace `permissionPayloadValidator` field with `permissionService` in `EngineDeps`. Simplify `handleCardAction()` to delegate entirely. Also replace `sender: ChannelSender` with `senderFactory: SenderFactory` for command responses.

- [ ] **Step 1: Write / update Engine tests**

If `Engine.test.ts` exists, update the mock deps. If not, create minimal tests:

```typescript
// packages/atlas-gateway/src/engine/Engine.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EngineImpl } from './Engine.js';
import type { EngineDeps, CardActionEvent } from './Engine.js';

function createMockDeps(overrides?: Partial<EngineDeps>): EngineDeps {
  return {
    cardStore: {} as any,
    correlationStore: {} as any,
    pipeline: { dispose: vi.fn() } as any,
    cardEngine: {} as any,
    sessionManager: { restore: vi.fn().mockResolvedValue(undefined), persist: vi.fn().mockResolvedValue(undefined) } as any,
    commandRegistry: { resolve: vi.fn().mockReturnValue(null) } as any,
    permissionService: { handleAction: vi.fn().mockResolvedValue(undefined) } as any,
    senderFactory: vi.fn().mockReturnValue({
      sendText: vi.fn().mockResolvedValue('msg_1'),
      sendCard: vi.fn().mockResolvedValue('msg_1'),
    }),
    ...overrides,
  };
}

describe('EngineImpl', () => {
  describe('handleCardAction', () => {
    it('delegates to permissionService.handleAction', async () => {
      const deps = createMockDeps();
      const engine = new EngineImpl(deps);

      const event: CardActionEvent = {
        messageId: 'msg_1',
        chatId: 'chat_1',
        userId: 'user_1',
        value: { v: 1, action: 'allow' },
      };

      await engine.handleCardAction(event);
      expect(deps.permissionService.handleAction).toHaveBeenCalledWith(event);
    });
  });

  describe('handleChannelEvent', () => {
    it('calls onPrompt for non-command messages', async () => {
      const onPrompt = vi.fn().mockResolvedValue(undefined);
      const deps = createMockDeps({ onPrompt });
      const sessionManager = {
        restore: vi.fn().mockResolvedValue(undefined),
        persist: vi.fn().mockResolvedValue(undefined),
        getOrCreate: vi.fn().mockResolvedValue({ sessionId: 's1', chatId: 'chat_1' }),
      } as any;
      const engine = new EngineImpl({ ...deps, sessionManager });

      await engine.handleChannelEvent({
        channelId: 'feishu',
        chatId: 'chat_1',
        userId: 'u1',
        userName: '',
        messageId: 'm1',
        content: { type: 'text', text: 'hello' },
        timestamp: Date.now(),
      });

      expect(onPrompt).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/atlas-gateway && npx vitest run src/engine/Engine.test.ts`
Expected: FAIL — `permissionService` not in `EngineDeps`

- [ ] **Step 3: Refactor Engine**

In `packages/atlas-gateway/src/engine/Engine.ts`:

1. **Remove** `PermissionPayloadValidatorImpl` import and field
2. **Add** imports:
```typescript
import type { PermissionService } from './PermissionService.js';
import type { SenderFactory } from '../channel/ChannelSender.js';
```

3. **Update EngineDeps**:
```typescript
export interface EngineDeps {
  cardStore: CardStateStoreImpl;
  correlationStore: MessageCorrelationStoreImpl;
  pipeline: CardRenderPipeline;
  cardEngine: CardEngineImpl;
  sessionManager: SessionManagerImpl;
  commandRegistry: CommandRegistryImpl;
  permissionService: PermissionService;   // REPLACES permissionPayloadValidator
  senderFactory: SenderFactory;            // REPLACES sender: ChannelSender
  onPrompt?: OnPromptCallback;
}
```

4. **Update constructor** to store `permissionService` and `senderFactory`

5. **Simplify handleCardAction**:
```typescript
async handleCardAction(event: CardActionEvent): Promise<void> {
  await this.permissionService.handleAction(event);
}
```

6. **Update handleChannelEvent** to use `senderFactory(event.chatId)` for command responses:
```typescript
const sender = this.senderFactory(event.chatId);
// ... use sender for sendText/sendCard
```

- [ ] **Step 4: Run all tests to verify they pass**

Run: `cd packages/atlas-gateway && npx vitest run`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
cd packages/atlas-gateway
git add src/engine/Engine.ts src/engine/Engine.test.ts
git commit -m "refactor(gateway): Engine delegates to PermissionService and uses SenderFactory"
```

---

### Task 8: Update barrel exports

**Files:**
- Modify: `packages/atlas-gateway/src/engine/index.ts`
- Modify: `packages/atlas-gateway/src/channel/feishu/index.ts`
- Modify: `packages/atlas-gateway/src/channel/ChannelSender.ts` (already done in Task 3)

- [ ] **Step 1: Add exports to engine/index.ts**

Append to `packages/atlas-gateway/src/engine/index.ts`:

```typescript
export { SessionQueue, sessionKey } from './SessionQueue.js';

export { AgentBridge } from './AgentBridge.js';
export type { AgentBridgeConfig, AgentBridgeDeps } from './AgentBridge.js';

export { PermissionService } from './PermissionService.js';
export type { PermissionServiceDeps } from './PermissionService.js';
```

- [ ] **Step 2: Add FeishuCardActionEvent export to feishu/index.ts**

Append to `packages/atlas-gateway/src/channel/feishu/index.ts`:

```typescript
export type { FeishuCardActionEvent } from './FeishuAdapter.js';
```

- [ ] **Step 3: Verify build compiles**

Run: `cd packages/atlas-gateway && npx tsc --noEmit`
Expected: Clean — no errors

- [ ] **Step 4: Commit**

```bash
cd packages/atlas-gateway
git add src/engine/index.ts src/channel/feishu/index.ts
git commit -m "feat(gateway): export SessionQueue, AgentBridge, PermissionService from barrel"
```

---

## Chunk 4: atlas-cli Bootstrap

### Task 9: createApp factory + CLI entry point

**Files:**
- Create: `packages/atlas-cli/src/createApp.ts`
- Modify: `packages/atlas-cli/src/index.ts`
- Modify: `packages/atlas-cli/package.json`

**Context:** `atlas-cli` currently has a stub `index.ts` that does `console.log('atlas-cli')`. We replace it with a real bootstrap. `createApp()` is a factory that wires all dependencies and returns `{ start, stop }`. The entry point calls `createApp(loadEnvConfig()).start()`.

Dependencies available: `atlas-gateway` (all engine + channel exports), `atlas-agent` (AgentRegistry, AgentId).

- [ ] **Step 1: Add dotenv dependency to atlas-cli**

```bash
cd packages/atlas-cli && yarn add dotenv
```

- [ ] **Step 2: Create createApp.ts**

```typescript
// packages/atlas-cli/src/createApp.ts
import type { AgentId } from 'atlas-agent';
import { agentRegistry } from 'atlas-agent';
import {
  CardStateStoreImpl,
  MessageCorrelationStoreImpl,
  SessionManagerImpl,
  CardRenderPipeline,
  CardEngineImpl,
  EngineImpl,
  ToolCardBuilderImpl,
  PermissionCardBuilderImpl,
  PermissionPayloadValidatorImpl,
  FeishuAdapter,
  FeishuChannelSender,
  FeishuCardRenderer,
  AgentBridge,
  PermissionService,
  CommandRegistryImpl,
} from 'atlas-gateway';
import type { ChannelSender, SenderFactory, CardActionEvent, LarkWSClient } from 'atlas-gateway';

// ── Types ──────────────────────────────────────────────────────────────────

export interface AppConfig {
  feishuAppId: string;
  feishuAppSecret: string;
  agentId: AgentId;
  cwd: string;
  env?: Record<string, string>;
}

export interface App {
  start(): Promise<void>;
  stop(): Promise<void>;
}

// ── Factory ────────────────────────────────────────────────────────────────

export function createApp(config: AppConfig): App {
  // 1. Stores
  const cardStore = new CardStateStoreImpl();
  const correlationStore = new MessageCorrelationStoreImpl();
  const sessionManager = new SessionManagerImpl();

  // 2. Feishu card renderer + sender factory
  const cardRenderer = new FeishuCardRenderer();

  // LarkClient must be created from the real SDK at runtime.
  // We defer construction to start() to keep createApp() synchronous.
  let larkClient: any = null;

  const senderFactory: SenderFactory = (chatId: string): ChannelSender =>
    new FeishuChannelSender(larkClient, chatId, cardRenderer);

  // 3. Card render pipeline (auto-subscribes to cardStore.onChange)
  const pipeline = new CardRenderPipeline(cardStore, cardRenderer, senderFactory, correlationStore);

  // 4. Card engine
  const cardEngine = new CardEngineImpl({
    cardStore,
    correlationStore,
    toolCardBuilder: new ToolCardBuilderImpl(),
    permissionCardBuilder: new PermissionCardBuilderImpl(),
  });

  // 5. Agent bridge
  const bridge = new AgentBridge({
    registry: agentRegistry,
    cardEngine,
    config: {
      agentId: config.agentId,
      cwd: config.cwd,
      env: config.env,
    },
  });

  // 6. Permission service
  const permissionService = new PermissionService({
    validator: new PermissionPayloadValidatorImpl(),
    cardEngine,
    bridge,
  });

  // 7. Command registry
  const commandRegistry = new CommandRegistryImpl(sessionManager);

  // 8. Engine
  const engine = new EngineImpl({
    cardStore,
    correlationStore,
    pipeline,
    cardEngine,
    sessionManager,
    commandRegistry,
    permissionService,
    senderFactory,
    onPrompt: (session, event) => bridge.handlePrompt(session, event),
  });

  // 9. Feishu adapter (created in start to allow async SDK init)
  let adapter: InstanceType<typeof FeishuAdapter> | null = null;

  return {
    async start() {
      // Initialize Lark SDK client
      // Dynamic import to handle environments where SDK isn't installed
      const lark = await import('@larksuiteoapi/node-sdk');
      larkClient = new lark.Client({
        appId: config.feishuAppId,
        appSecret: config.feishuAppSecret,
      });

      adapter = new FeishuAdapter({
        config: { appId: config.feishuAppId, appSecret: config.feishuAppSecret },
        larkClient: larkClient as any,
        wsClientFactory: (appId: string, appSecret: string) =>
          new lark.WSClient({
            appId,
            appSecret,
            loggerLevel: lark.LoggerLevel.warn,
          }) as unknown as LarkWSClient,
        eventDispatcherFactory: (handlers: Record<string, (data: unknown) => Promise<unknown>>) =>
          new lark.EventDispatcher({}).register(handlers),
        onCardAction: (event: CardActionEvent) => engine.handleCardAction(event),
      });

      await engine.start();
      await adapter.start((event) => engine.handleChannelEvent(event));

      console.log('[atlas] Started — listening for Feishu messages');
    },

    async stop() {
      console.log('[atlas] Shutting down...');
      if (adapter) await adapter.stop();
      await bridge.dispose();
      await engine.stop();
      console.log('[atlas] Stopped');
    },
  };
}
```

- [ ] **Step 3: Replace index.ts stub**

```typescript
// packages/atlas-cli/src/index.ts
import 'dotenv/config';
import type { AgentId } from 'atlas-agent';
import { createApp } from './createApp.js';

const required = (name: string): string => {
  const val = process.env[name];
  if (!val) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return val;
};

const app = createApp({
  feishuAppId: required('FEISHU_APP_ID'),
  feishuAppSecret: required('FEISHU_APP_SECRET'),
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

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd packages/atlas-cli && npx tsc --noEmit`
Expected: Clean (may need to add @larksuiteoapi/node-sdk to dependencies or devDependencies if not transitively available)

- [ ] **Step 5: Commit**

```bash
cd packages/atlas-cli
git add src/createApp.ts src/index.ts package.json
git commit -m "feat(cli): wire createApp bootstrap with all Phase 3 dependencies"
```

---

### Task 10: Final integration verification

- [ ] **Step 1: Run all gateway tests**

Run: `cd packages/atlas-gateway && npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Type-check the entire monorepo**

Run: `cd packages/atlas-gateway && npx tsc --noEmit && cd ../atlas-cli && npx tsc --noEmit && cd ../atlas-agent && npx tsc --noEmit`
Expected: Clean — no errors

- [ ] **Step 3: Commit any remaining fixes**

If type checking reveals issues, fix them and commit.

- [ ] **Step 4: Final commit summary**

Run: `git log --oneline -10` to verify the commit history is clean.

Expected commits (newest first):
```
feat(cli): wire createApp bootstrap with all Phase 3 dependencies
feat(gateway): export SessionQueue, AgentBridge, PermissionService from barrel
refactor(gateway): Engine delegates to PermissionService and uses SenderFactory
feat(gateway): add card action support to FeishuAdapter
feat(gateway): add PermissionService for permission business logic
feat(gateway): add AgentBridge for agent lifecycle and message bridging
feat(gateway): add threadId to ChannelEvent for group thread support
feat(gateway): add SessionQueue for per-session serial execution
```
