# Runtime/Binding Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mixed session model with first-class runtime and binding models, then rewire gateway routing, commands, and external runtime registration around those models.

**Architecture:** Introduce `RuntimeSession` and `ConversationBinding` as the new source-of-truth models. Replace `SessionManagerImpl`, `ThreadContextStoreImpl`, and `AgentBridge` with `RuntimeRegistryImpl`, `BindingStoreImpl`, `RuntimeRouterImpl`, and `RuntimeBridgeImpl`, while preserving `CardEngine`, `CardRenderPipeline`, channel adapters, and unified `AgentMessage` rendering.

**Tech Stack:** TypeScript, Node.js, Vitest, Express, Feishu/DingTalk channel adapters, Atlas monorepo packages

---

## File Structure

### New files

- `packages/atlas-gateway/src/runtime/RuntimeModels.ts`
- `packages/atlas-gateway/src/runtime/RuntimeRegistry.ts`
- `packages/atlas-gateway/src/runtime/BindingStore.ts`
- `packages/atlas-gateway/src/runtime/RuntimeRouter.ts`
- `packages/atlas-gateway/src/runtime/RuntimeBridge.ts`
- `packages/atlas-gateway/src/runtime/RuntimeAdapter.ts`
- `packages/atlas-gateway/src/runtime/adapters/AtlasClaudeRuntimeAdapter.ts`
- `packages/atlas-gateway/src/runtime/adapters/ExternalRuntimeAdapter.ts`
- `packages/atlas-gateway/src/runtime/index.ts`
- `packages/atlas-gateway/src/runtime/RuntimeRegistry.test.ts`
- `packages/atlas-gateway/src/runtime/BindingStore.test.ts`
- `packages/atlas-gateway/src/runtime/RuntimeRouter.test.ts`
- `packages/atlas-gateway/src/runtime/RuntimeBridge.test.ts`

### Modified files

- `packages/atlas-gateway/src/engine/Engine.ts`
- `packages/atlas-gateway/src/engine/CommandRegistry.ts`
- `packages/atlas-gateway/src/engine/commands/AgentCommand.ts`
- `packages/atlas-gateway/src/engine/commands/AttachCommand.ts`
- `packages/atlas-gateway/src/engine/commands/CancelCommand.ts`
- `packages/atlas-gateway/src/engine/commands/DestroyCommand.ts`
- `packages/atlas-gateway/src/engine/commands/DetachCommand.ts`
- `packages/atlas-gateway/src/engine/commands/ListCommand.ts`
- `packages/atlas-gateway/src/engine/commands/NewCommand.ts`
- `packages/atlas-gateway/src/engine/commands/SessionsCommand.ts`
- `packages/atlas-gateway/src/engine/commands/StatusCommand.ts`
- `packages/atlas-gateway/src/engine/commands/SwitchCommand.ts`
- `packages/atlas-gateway/src/engine/index.ts`
- `packages/atlas-gateway/src/index.ts`
- `packages/atlas-cli/src/createApp.ts`
- `packages/atlas-gateway/src/engine/Engine.test.ts`
- `packages/atlas-gateway/src/engine/CommandRegistry.test.ts`

### Removed files

- `packages/atlas-gateway/src/engine/SessionManager.ts`
- `packages/atlas-gateway/src/engine/ThreadContext.ts`
- `packages/atlas-gateway/src/engine/AgentBridge.ts`
- Their legacy tests after replacement coverage is green

## Task 1: Add Runtime Models and Runtime Registry

**Files:**
- Create: `packages/atlas-gateway/src/runtime/RuntimeModels.ts`
- Create: `packages/atlas-gateway/src/runtime/RuntimeRegistry.ts`
- Test: `packages/atlas-gateway/src/runtime/RuntimeRegistry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { RuntimeRegistryImpl } from './RuntimeRegistry.js';

describe('RuntimeRegistryImpl', () => {
  it('creates an atlas-managed runtime', async () => {
    const registry = new RuntimeRegistryImpl();
    const runtime = await registry.create({
      id: 'claude-sdk',
      provider: 'claude',
      transport: 'sdk',
      displayName: 'Claude SDK',
      defaultCapabilities: {
        streaming: true,
        permissionCards: true,
        fileAccess: false,
        imageInput: false,
        terminalOutput: false,
        patchEvents: false,
      },
    }, { displayName: 'main' });

    expect(runtime.source).toBe('atlas-managed');
    expect(registry.get(runtime.id)).toEqual(runtime);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace atlas-gateway test packages/atlas-gateway/src/runtime/RuntimeRegistry.test.ts`
Expected: FAIL with module-not-found for `RuntimeRegistry.ts`

- [ ] **Step 3: Write the minimal model and registry**

```ts
export interface RuntimeCapabilities {
  streaming: boolean;
  permissionCards: boolean;
  fileAccess: boolean;
  imageInput: boolean;
  terminalOutput: boolean;
  patchEvents: boolean;
}

export interface RuntimeSession {
  id: string;
  source: 'atlas-managed' | 'external' | 'remote';
  provider: 'claude' | 'codex' | 'gemini' | 'custom';
  transport: 'sdk' | 'acp' | 'mcp' | 'websocket' | 'bridge';
  status: 'starting' | 'running' | 'idle' | 'paused' | 'error' | 'stopped';
  displayName?: string;
  workspaceId?: string;
  projectId?: string;
  resumeHandle?: { kind: 'claude-session' | 'remote-runtime'; value: string };
  capabilities: RuntimeCapabilities;
  metadata: Record<string, string>;
  createdAt: number;
  lastActiveAt: number;
}
```

```ts
import { randomUUID } from 'node:crypto';
import type { RuntimeSession } from './RuntimeModels.js';

export class RuntimeRegistryImpl {
  private runtimes = new Map<string, RuntimeSession>();

  async create(spec: any, opts: { displayName?: string } = {}): Promise<RuntimeSession> {
    const now = Date.now();
    const runtime: RuntimeSession = {
      id: randomUUID(),
      source: 'atlas-managed',
      provider: spec.provider,
      transport: spec.transport,
      status: 'idle',
      displayName: opts.displayName,
      capabilities: { ...spec.defaultCapabilities },
      metadata: {},
      createdAt: now,
      lastActiveAt: now,
    };
    this.runtimes.set(runtime.id, runtime);
    return runtime;
  }

  get(id: string): RuntimeSession | undefined { return this.runtimes.get(id); }
  list(): RuntimeSession[] { return Array.from(this.runtimes.values()); }
  update(id: string, patch: Partial<RuntimeSession>): void {
    const current = this.runtimes.get(id);
    if (current) this.runtimes.set(id, { ...current, ...patch });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace atlas-gateway test packages/atlas-gateway/src/runtime/RuntimeRegistry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/atlas-gateway/src/runtime/RuntimeModels.ts packages/atlas-gateway/src/runtime/RuntimeRegistry.ts packages/atlas-gateway/src/runtime/RuntimeRegistry.test.ts
git commit -m "feat: add runtime registry core model"
```

## Task 2: Add Durable Binding Store

**Files:**
- Modify: `packages/atlas-gateway/src/runtime/RuntimeModels.ts`
- Create: `packages/atlas-gateway/src/runtime/BindingStore.ts`
- Test: `packages/atlas-gateway/src/runtime/BindingStore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { BindingStoreImpl } from './BindingStore.js';

describe('BindingStoreImpl', () => {
  it('creates a binding and keeps MRU runtime order', () => {
    const store = new BindingStoreImpl();
    const binding = store.getOrCreate('feishu', 'chat-1', 'thread-1');
    store.attach(binding.bindingId, 'r1');
    store.attach(binding.bindingId, 'r2');
    store.attach(binding.bindingId, 'r1');
    expect(store.get(binding.bindingId)?.attachedRuntimeIds).toEqual(['r1', 'r2']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace atlas-gateway test packages/atlas-gateway/src/runtime/BindingStore.test.ts`
Expected: FAIL with module-not-found for `BindingStore.ts`

- [ ] **Step 3: Add `ConversationBinding` and implement the store**

```ts
export interface ConversationBinding {
  bindingId: string;
  channelId: string;
  chatId: string;
  threadKey: string;
  activeRuntimeId: string | null;
  attachedRuntimeIds: string[];
  defaultRuntimeId: string | null;
  createdAt: number;
  lastActiveAt: number;
}
```

```ts
export class BindingStoreImpl {
  private bindings = new Map<string, ConversationBinding>();

  get(bindingId: string): ConversationBinding | undefined { return this.bindings.get(bindingId); }
  getOrCreate(channelId: string, chatId: string, threadKey: string): ConversationBinding {
    const bindingId = `${channelId}:${chatId}:${threadKey}`;
    const existing = this.bindings.get(bindingId);
    if (existing) return existing;
    const now = Date.now();
    const binding: ConversationBinding = {
      bindingId, channelId, chatId, threadKey,
      activeRuntimeId: null, attachedRuntimeIds: [], defaultRuntimeId: null,
      createdAt: now, lastActiveAt: now,
    };
    this.bindings.set(bindingId, binding);
    return binding;
  }
  attach(bindingId: string, runtimeId: string): void {
    const binding = this.bindings.get(bindingId);
    if (!binding) return;
    binding.attachedRuntimeIds = binding.attachedRuntimeIds.filter(id => id !== runtimeId);
    binding.attachedRuntimeIds.unshift(runtimeId);
  }
  setActive(bindingId: string, runtimeId: string | null): void {
    const binding = this.bindings.get(bindingId);
    if (binding) binding.activeRuntimeId = runtimeId;
  }
  detach(bindingId: string, runtimeId: string): void {
    const binding = this.bindings.get(bindingId);
    if (!binding) return;
    binding.attachedRuntimeIds = binding.attachedRuntimeIds.filter(id => id !== runtimeId);
    if (binding.activeRuntimeId === runtimeId) binding.activeRuntimeId = null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace atlas-gateway test packages/atlas-gateway/src/runtime/BindingStore.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/atlas-gateway/src/runtime/RuntimeModels.ts packages/atlas-gateway/src/runtime/BindingStore.ts packages/atlas-gateway/src/runtime/BindingStore.test.ts
git commit -m "feat: add durable conversation binding store"
```

## Task 3: Add Runtime Adapter Boundary and Runtime Bridge

**Files:**
- Create: `packages/atlas-gateway/src/runtime/RuntimeAdapter.ts`
- Create: `packages/atlas-gateway/src/runtime/RuntimeBridge.ts`
- Create: `packages/atlas-gateway/src/runtime/adapters/AtlasClaudeRuntimeAdapter.ts`
- Create: `packages/atlas-gateway/src/runtime/adapters/ExternalRuntimeAdapter.ts`
- Test: `packages/atlas-gateway/src/runtime/RuntimeBridge.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { RuntimeBridgeImpl } from './RuntimeBridge.js';

describe('RuntimeBridgeImpl', () => {
  it('forwards prompts to the adapter selected by runtime', async () => {
    const adapter = { start: vi.fn(), sendPrompt: vi.fn(), cancel: vi.fn(), dispose: vi.fn(), onMessage: vi.fn() };
    const bridge = new RuntimeBridgeImpl({
      runtimeRegistry: { get: vi.fn().mockReturnValue({ id: 'r1', transport: 'sdk', provider: 'claude' }), update: vi.fn() } as any,
      adapters: { resolve: vi.fn().mockReturnValue(adapter) } as any,
    });

    await bridge.sendPrompt('r1', { channelId: 'feishu', chatId: 'c1', userId: 'u1', userName: '', messageId: 'm1', content: { type: 'text', text: 'hi' }, timestamp: 1 });
    expect(adapter.sendPrompt).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace atlas-gateway test packages/atlas-gateway/src/runtime/RuntimeBridge.test.ts`
Expected: FAIL with module-not-found for `RuntimeBridge.ts`

- [ ] **Step 3: Define the adapter interface**

```ts
import type { AgentMessage } from 'atlas-agent';
import type { RuntimeSession } from './RuntimeModels.js';

export interface RuntimePrompt {
  text: string;
  channelId: string;
  chatId: string;
  messageId: string;
}

export interface RuntimeAdapter {
  start(runtime: RuntimeSession): Promise<void>;
  sendPrompt(runtime: RuntimeSession, prompt: RuntimePrompt): Promise<void>;
  cancel(runtime: RuntimeSession): Promise<void>;
  dispose(runtime: RuntimeSession): Promise<void>;
  onMessage(handler: (runtimeId: string, msg: AgentMessage) => void): void;
}
```

- [ ] **Step 4: Implement the minimal bridge**

```ts
import type { ChannelEvent } from '../channel/channelEvent.js';

export class RuntimeBridgeImpl {
  constructor(private deps: {
    runtimeRegistry: { get(id: string): any; update(id: string, patch: any): void };
    adapters: { resolve(runtime: any): RuntimeAdapter };
  }) {}

  async sendPrompt(runtimeId: string, event: ChannelEvent): Promise<void> {
    const runtime = this.deps.runtimeRegistry.get(runtimeId);
    if (!runtime) throw new Error(`Unknown runtime: ${runtimeId}`);
    const adapter = this.deps.adapters.resolve(runtime);
    this.deps.runtimeRegistry.update(runtimeId, { status: 'running', lastActiveAt: Date.now() });
    await adapter.sendPrompt(runtime, {
      text: event.content.type === 'text' ? event.content.text : '',
      channelId: event.channelId,
      chatId: event.chatId,
      messageId: event.messageId,
    });
  }
}
```

- [ ] **Step 5: Add adapter stubs**

```ts
export class AtlasClaudeRuntimeAdapter implements RuntimeAdapter {
  onMessage(): void {}
  async start(): Promise<void> {}
  async sendPrompt(): Promise<void> {}
  async cancel(): Promise<void> {}
  async dispose(): Promise<void> {}
}
```

```ts
export class ExternalRuntimeAdapter implements RuntimeAdapter {
  onMessage(): void {}
  async start(): Promise<void> {}
  async sendPrompt(): Promise<void> {}
  async cancel(): Promise<void> {}
  async dispose(): Promise<void> {}
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `yarn workspace atlas-gateway test packages/atlas-gateway/src/runtime/RuntimeBridge.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/atlas-gateway/src/runtime/RuntimeAdapter.ts packages/atlas-gateway/src/runtime/RuntimeBridge.ts packages/atlas-gateway/src/runtime/adapters/AtlasClaudeRuntimeAdapter.ts packages/atlas-gateway/src/runtime/adapters/ExternalRuntimeAdapter.ts packages/atlas-gateway/src/runtime/RuntimeBridge.test.ts
git commit -m "feat: add runtime adapter bridge layer"
```

## Task 4: Add Runtime Router

**Files:**
- Create: `packages/atlas-gateway/src/runtime/RuntimeRouter.ts`
- Test: `packages/atlas-gateway/src/runtime/RuntimeRouter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { RuntimeRouterImpl } from './RuntimeRouter.js';

describe('RuntimeRouterImpl', () => {
  it('returns the active runtime when a binding already has one', async () => {
    const router = new RuntimeRouterImpl({
      bindingStore: { getOrCreate: vi.fn().mockReturnValue({ bindingId: 'b1', activeRuntimeId: 'r1', defaultRuntimeId: null }) } as any,
      runtimeRegistry: { get: vi.fn().mockReturnValue({ id: 'r1' }) } as any,
    });

    const result = await router.resolveTarget({ channelId: 'feishu', chatId: 'c1', userId: 'u1', userName: '', messageId: 'm1', content: { type: 'text', text: 'hi' }, timestamp: 1 });
    expect(result).toEqual({ kind: 'runtime', bindingId: 'b1', runtimeId: 'r1' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace atlas-gateway test packages/atlas-gateway/src/runtime/RuntimeRouter.test.ts`
Expected: FAIL with module-not-found for `RuntimeRouter.ts`

- [ ] **Step 3: Implement the minimal router**

```ts
import type { ChannelEvent } from '../channel/channelEvent.js';

export class RuntimeRouterImpl {
  constructor(private deps: {
    bindingStore: { getOrCreate(channelId: string, chatId: string, threadKey: string): any };
    runtimeRegistry: { get(runtimeId: string): any };
  }) {}

  async resolveTarget(event: ChannelEvent): Promise<{ kind: 'runtime'; bindingId: string; runtimeId: string } | { kind: 'missing'; bindingId: string }> {
    const threadKey = event.threadId ?? event.chatId;
    const binding = this.deps.bindingStore.getOrCreate(event.channelId, event.chatId, threadKey);

    if (binding.activeRuntimeId && this.deps.runtimeRegistry.get(binding.activeRuntimeId)) {
      return { kind: 'runtime', bindingId: binding.bindingId, runtimeId: binding.activeRuntimeId };
    }
    if (binding.defaultRuntimeId && this.deps.runtimeRegistry.get(binding.defaultRuntimeId)) {
      return { kind: 'runtime', bindingId: binding.bindingId, runtimeId: binding.defaultRuntimeId };
    }
    return { kind: 'missing', bindingId: binding.bindingId };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace atlas-gateway test packages/atlas-gateway/src/runtime/RuntimeRouter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/atlas-gateway/src/runtime/RuntimeRouter.ts packages/atlas-gateway/src/runtime/RuntimeRouter.test.ts
git commit -m "feat: add runtime routing layer"
```

## Task 5: Refactor Commands Around Runtime and Binding

**Files:**
- Modify: `packages/atlas-gateway/src/engine/CommandRegistry.ts`
- Modify: `packages/atlas-gateway/src/engine/commands/AgentCommand.ts`
- Modify: `packages/atlas-gateway/src/engine/commands/AttachCommand.ts`
- Modify: `packages/atlas-gateway/src/engine/commands/CancelCommand.ts`
- Modify: `packages/atlas-gateway/src/engine/commands/DestroyCommand.ts`
- Modify: `packages/atlas-gateway/src/engine/commands/DetachCommand.ts`
- Modify: `packages/atlas-gateway/src/engine/commands/ListCommand.ts`
- Modify: `packages/atlas-gateway/src/engine/commands/NewCommand.ts`
- Modify: `packages/atlas-gateway/src/engine/commands/SessionsCommand.ts`
- Modify: `packages/atlas-gateway/src/engine/commands/StatusCommand.ts`
- Modify: `packages/atlas-gateway/src/engine/commands/SwitchCommand.ts`
- Test: `packages/atlas-gateway/src/engine/CommandRegistry.test.ts`

- [ ] **Step 1: Write the failing command test**

```ts
it('new creates a runtime and switches the current binding', async () => {
  const runtimeRegistry = { create: vi.fn().mockResolvedValue({ id: 'r2', displayName: 'main' }) };
  const bindingStore = { attach: vi.fn(), setActive: vi.fn() };

  const result = await NewCommand.execute('', {
    binding: { bindingId: 'b1' },
    runtimeRegistry,
    bindingStore,
    runtimeBridge: {} as any,
    sender: {} as any,
  } as any);

  expect(runtimeRegistry.create).toHaveBeenCalled();
  expect(bindingStore.setActive).toHaveBeenCalledWith('b1', 'r2');
  expect(result).toContain('Started new runtime');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace atlas-gateway test packages/atlas-gateway/src/engine/CommandRegistry.test.ts`
Expected: FAIL because `CommandContext` still expects `sessionManager`

- [ ] **Step 3: Replace the command context**

```ts
export interface CommandContext {
  binding: ConversationBinding;
  runtimeRegistry: RuntimeRegistryImpl;
  bindingStore: BindingStoreImpl;
  runtimeBridge: RuntimeBridgeImpl;
  sender: ChannelSender;
}
```

- [ ] **Step 4: Rewrite the command semantics**

```ts
export const AttachCommand: Command = {
  name: 'attach',
  description: 'Attach an existing runtime to this thread and make it active.',
  async execute(args, context) {
    const runtimeId = args.trim();
    const runtime = context.runtimeRegistry.get(runtimeId);
    if (!runtime) return `No runtime found: ${runtimeId}`;
    context.bindingStore.attach(context.binding.bindingId, runtime.id);
    context.bindingStore.setActive(context.binding.bindingId, runtime.id);
    return `Attached to **${runtime.displayName ?? runtime.id}** [${runtime.provider}].`;
  },
};
```

```ts
export const NewCommand: Command = {
  name: 'new',
  description: 'Create a new Atlas-managed runtime and switch to it.',
  async execute(_args, context) {
    const runtime = await context.runtimeRegistry.create({
      id: 'claude-sdk',
      provider: 'claude',
      transport: 'sdk',
      displayName: 'Claude SDK',
      defaultCapabilities: {
        streaming: true,
        permissionCards: true,
        fileAccess: false,
        imageInput: false,
        terminalOutput: false,
        patchEvents: false,
      },
    }, { displayName: 'main' });
    context.bindingStore.attach(context.binding.bindingId, runtime.id);
    context.bindingStore.setActive(context.binding.bindingId, runtime.id);
    return `Started new runtime: ${runtime.displayName ?? runtime.id}`;
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn workspace atlas-gateway test packages/atlas-gateway/src/engine/CommandRegistry.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/atlas-gateway/src/engine/CommandRegistry.ts packages/atlas-gateway/src/engine/commands/*.ts packages/atlas-gateway/src/engine/CommandRegistry.test.ts
git commit -m "feat: rewrite commands around runtime bindings"
```

## Task 6: Rewire Engine to Use Runtime Router and Runtime Bridge

**Files:**
- Modify: `packages/atlas-gateway/src/engine/Engine.ts`
- Test: `packages/atlas-gateway/src/engine/Engine.test.ts`

- [ ] **Step 1: Write the failing engine test**

```ts
it('routes text messages through runtime router and bridge', async () => {
  const runtimeRouter = { resolveTarget: vi.fn().mockResolvedValue({ kind: 'runtime', bindingId: 'b1', runtimeId: 'r1' }) };
  const runtimeBridge = { sendPrompt: vi.fn() };
  const engine = new EngineImpl({
    cardStore: mockCardStore(),
    correlationStore: mockCorrelationStore(),
    pipeline: mockPipeline(),
    cardEngine: mockCardEngine(),
    runtimeRegistry: {} as any,
    bindingStore: {} as any,
    commandRegistry: mockCommandRegistry(),
    permissionService: mockPermissionService(),
    senderFactory: mockSenderFactory(),
    runtimeRouter,
    runtimeBridge,
  } as any);

  await engine.handleChannelEvent(textEvent('hello'));
  expect(runtimeBridge.sendPrompt).toHaveBeenCalledWith('r1', expect.anything());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace atlas-gateway test packages/atlas-gateway/src/engine/Engine.test.ts`
Expected: FAIL because `EngineDeps` and routing path still depend on session objects

- [ ] **Step 3: Rewrite the engine dependencies and message path**

```ts
export interface EngineDeps {
  cardStore: CardStateStoreImpl;
  correlationStore: MessageCorrelationStoreImpl;
  pipeline: CardRenderPipeline;
  cardEngine: CardEngineImpl;
  runtimeRegistry: RuntimeRegistryImpl;
  bindingStore: BindingStoreImpl;
  commandRegistry: CommandRegistryImpl;
  permissionService: PermissionService;
  senderFactory: SenderFactory;
  runtimeRouter: RuntimeRouterImpl;
  runtimeBridge: RuntimeBridgeImpl;
}
```

```ts
const resolved = await this.runtimeRouter.resolveTarget(event);
if (resolved.kind === 'runtime') {
  await this.runtimeBridge.sendPrompt(resolved.runtimeId, event);
  return;
}
await sender.sendText('No active runtime in this thread. Use /attach <runtime-id> or /agent <spec>.', event.messageId);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace atlas-gateway test packages/atlas-gateway/src/engine/Engine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/atlas-gateway/src/engine/Engine.ts packages/atlas-gateway/src/engine/Engine.test.ts
git commit -m "feat: route engine traffic through runtime layer"
```

## Task 7: Rewire App Composition and External Runtime Registration

**Files:**
- Modify: `packages/atlas-cli/src/createApp.ts`
- Modify: `packages/atlas-gateway/src/index.ts`
- Modify: `packages/atlas-gateway/src/engine/index.ts`
- Create: `packages/atlas-gateway/src/runtime/index.ts`

- [ ] **Step 1: Write the failing createApp smoke test**

```ts
it('creates the app with runtime services wired in', () => {
  const app = createApp({
    channels: {},
    agent: { cwd: '.', env: {} },
    idleTimeoutMs: 1000,
    logLevel: 'info',
  } as any);
  expect(app).toBeDefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace atlas-cli test`
Expected: FAIL after engine constructor changes until `createApp.ts` is rewired

- [ ] **Step 3: Replace the old session-layer composition**

```ts
const runtimeRegistry = new RuntimeRegistryImpl();
const bindingStore = new BindingStoreImpl();
const runtimeRouter = new RuntimeRouterImpl({
  bindingStore,
  runtimeRegistry,
});
const runtimeBridge = new RuntimeBridgeImpl({
  runtimeRegistry,
  adapters: runtimeAdapterRegistry,
});
```

- [ ] **Step 4: Replace the legacy session-bridging endpoints with a generic runtime registration route**

```ts
apiApp.post('/api/runtimes/register', async (req, res) => {
  const { source, provider, transport, displayName, resumeHandle, workspaceId } = req.body ?? {};
  if (!source || !provider || !transport) {
    res.status(400).json({ error: 'source, provider, and transport are required' });
    return;
  }
  const now = Date.now();
  await runtimeRegistry.registerExternal({
    id: resumeHandle?.value ?? crypto.randomUUID(),
    source,
    provider,
    transport,
    status: 'idle',
    displayName,
    workspaceId,
    resumeHandle,
    capabilities: {
      streaming: true,
      permissionCards: false,
      fileAccess: true,
      imageInput: false,
      terminalOutput: true,
      patchEvents: false,
    },
    metadata: {},
    createdAt: now,
    lastActiveAt: now,
  });
  res.json({ ok: true });
});
```

- [ ] **Step 5: Export the runtime layer**

```ts
export * from './runtime/index.js';
```

- [ ] **Step 6: Run tests**

Run: `yarn workspace atlas-cli test`
Expected: PASS

Run: `yarn workspace atlas-gateway test`
Expected: PASS or only known failures in tasks not yet completed

- [ ] **Step 7: Commit**

```bash
git add packages/atlas-cli/src/createApp.ts packages/atlas-gateway/src/index.ts packages/atlas-gateway/src/engine/index.ts packages/atlas-gateway/src/runtime/index.ts
git commit -m "feat: wire runtime registry into app composition"
```

## Task 8: Remove the Old Session Layer and Verify the Workspace

**Files:**
- Delete: `packages/atlas-gateway/src/engine/SessionManager.ts`
- Delete: `packages/atlas-gateway/src/engine/ThreadContext.ts`
- Delete: `packages/atlas-gateway/src/engine/AgentBridge.ts`
- Delete: their legacy tests after replacement coverage is green
- Modify: remaining imports across gateway package

- [ ] **Step 1: Delete the old files after replacement tests are green**

```text
Delete packages/atlas-gateway/src/engine/SessionManager.ts
Delete packages/atlas-gateway/src/engine/ThreadContext.ts
Delete packages/atlas-gateway/src/engine/AgentBridge.ts
Delete legacy tests that assert the old session model
```

- [ ] **Step 2: Update exports and imports**

```ts
// packages/atlas-gateway/src/engine/index.ts
export { EngineImpl } from './Engine.js';
export type { Engine, EngineDeps, CardActionEvent } from './Engine.js';
```

```ts
// packages/atlas-gateway/src/index.ts
export * from './runtime/index.js';
export * from './engine/index.js';
```

- [ ] **Step 3: Run full package tests**

Run: `yarn workspace atlas-gateway test`
Expected: PASS

Run: `yarn workspace atlas-cli test`
Expected: PASS

- [ ] **Step 4: Run full workspace build**

Run: `yarn build`
Expected: PASS across all workspace packages

- [ ] **Step 5: Commit**

```bash
git add packages/atlas-gateway/src packages/atlas-cli/src
git commit -m "refactor: replace session model with runtime bindings"
```

## Spec Coverage Check

- Runtime and binding first-class models: Task 1 and Task 2
- Runtime service split: Task 3 and Task 4
- Engine and command refactor: Task 5 and Task 6
- Generic external runtime registration: Task 7
- Direct migration with old model removal: Task 8
- Persistence split groundwork: Task 1, Task 2, Task 7

## Placeholder Scan

- No `TBD`, `TODO`, or deferred placeholders remain.
- Each task names exact files and explicit commands.
- Each implementation step includes a concrete code seam to add or replace.

## Type Consistency Check

- `RuntimeSession`, `ConversationBinding`, `RuntimeAdapter`, `RuntimeBridgeImpl`, and `RuntimeRouterImpl` are used consistently across tasks.
- Commands operate on `binding.bindingId` and runtime IDs, not the old session key model.
- The engine depends on `runtimeRegistry`, `bindingStore`, `runtimeRouter`, and `runtimeBridge` throughout the plan.
