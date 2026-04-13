# Runtime/Binding Dual-Layer Refactor Design

Date: 2026-04-13
Status: Approved for planning
Scope: Full architectural refactor of runtime/session modeling in Atlas AI

## 1. Context

Atlas AI is currently strong at channel-native interaction:

- Feishu and DingTalk adapters are already integrated into a unified gateway.
- Thread-aware routing, permission cards, streaming cards, and idle notifications already exist.
- `beam` can expose external Claude sessions to the gateway and attach them to IM threads.

However, the current runtime model is weak:

- The primary backend-managed "session" is not a true long-lived coding runtime.
- The system mixes three different ideas under the same word "session":
  - chat/thread routing state
  - runtime/process state
  - externally registered sessions such as `beam`
- `SessionManager` currently stores both chat-facing metadata and external runtime listings.
- `ThreadContextStore` is only an in-memory attachment table, not a durable binding model.
- Agent/runtime abstractions mix provider identity and transport identity, which makes the system harder to evolve.

The result is that Atlas behaves like a strong IM gateway, but not yet like a runtime-first coding system.

## 2. Goal

Refactor Atlas from a `channel-first` session model into a `runtime-first` architecture while preserving current IM interaction strengths.

The new design must:

- make runtime state a first-class model
- make IM-thread-to-runtime binding a first-class model
- unify Atlas-managed runtimes and externally registered runtimes under one abstraction
- remove the overloaded meaning of "session" from the codebase
- preserve Feishu/DingTalk thread workflows, cards, and permission interactions

## 3. Non-Goals

This refactor intentionally does not include:

- building a full project management UI
- keeping `SessionInfo` as the primary runtime model
- maintaining old `SessionManager` semantics in parallel
- shipping a compatibility or gray-release layer
- reusing the old `beam`-specific API shape as a long-term contract

This is a direct migration, not a staged dual-stack rollout.

## 4. Architectural Decision

Adopt a dual-layer runtime model:

- `RuntimeSession` represents a real runtime instance
- `ConversationBinding` represents which runtime an IM thread is attached to

Everything else is built around these two objects.

This avoids the current model confusion where a "session" sometimes means a chat-thread route, sometimes a provider-side process, and sometimes an external runtime registration.

## 5. Core Domain Model

### 5.1 RuntimeSession

`RuntimeSession` is the system-of-record for a live or recoverable runtime.

```ts
type RuntimeSessionId = string;
type WorkspaceId = string;
type ProjectId = string;

interface RuntimeSession {
  id: RuntimeSessionId;
  source: 'atlas-managed' | 'beam' | 'remote';
  provider: 'claude' | 'codex' | 'gemini' | 'custom';
  transport: 'sdk' | 'acp' | 'mcp' | 'websocket' | 'bridge';
  status: 'starting' | 'running' | 'idle' | 'paused' | 'error' | 'stopped';

  workspaceId?: WorkspaceId;
  projectId?: ProjectId;
  displayName?: string;

  resumeHandle?: {
    kind: 'claude-session' | 'beam-session' | 'remote-runtime';
    value: string;
  };

  capabilities: {
    streaming: boolean;
    permissionCards: boolean;
    fileAccess: boolean;
    imageInput: boolean;
    terminalOutput: boolean;
    patchEvents: boolean;
  };

  metadata: Record<string, string>;
  createdAt: number;
  lastActiveAt: number;
}
```

Semantics:

- A runtime exists independently of any particular chat thread.
- A runtime can be locally managed or externally registered.
- A runtime can be attached to one or more conversation bindings over time.
- A runtime may be resumable even when no binding currently points at it.

### 5.2 ConversationBinding

`ConversationBinding` is the system-of-record for thread-to-runtime routing.

```ts
interface ConversationBinding {
  bindingId: string; // channelId:chatId:threadKey
  channelId: string;
  chatId: string;
  threadKey: string;

  activeRuntimeId: RuntimeSessionId | null;
  attachedRuntimeIds: RuntimeSessionId[]; // MRU order
  defaultRuntimeId: RuntimeSessionId | null;

  createdAt: number;
  lastActiveAt: number;
}
```

Semantics:

- Each IM thread maps to one binding.
- A binding can attach multiple runtimes.
- Only one runtime is active at a time.
- Attached runtime order is MRU, which supports `/switch` and `/sessions`.
- `defaultRuntimeId` is a stable fallback distinct from the currently active runtime.

### 5.3 ProjectContext

`ProjectContext` is lightweight runtime grouping metadata.

```ts
interface ProjectContext {
  id: ProjectId;
  name: string;
  workspaceRoot?: string;
  repoRoot?: string;
  labels?: string[];
}
```

The first version keeps this intentionally thin. It exists to give runtime sessions a proper home without requiring a full project-management subsystem.

### 5.4 AgentSpec

`AgentSpec` defines how a particular runtime type is created.

```ts
interface AgentSpec {
  id: string; // claude-sdk / claude-beam / codex-remote
  provider: 'claude' | 'codex' | 'gemini' | 'custom';
  transport: 'sdk' | 'acp' | 'mcp' | 'websocket' | 'bridge';
  displayName: string;

  defaultCapabilities: RuntimeSession['capabilities'];
  createRuntime(opts: RuntimeLaunchOptions): Promise<RuntimeSessionHandle>;
}
```

This replaces the current loose coupling of `AgentId`, `AgentTransport`, and backend factory registration.

## 6. Core Services

### 6.1 RuntimeRegistry

`RuntimeRegistry` owns runtime lifecycle and persistence.

```ts
interface RuntimeRegistry {
  create(specId: string, opts: RuntimeLaunchOptions): Promise<RuntimeSession>;
  registerExternal(runtime: RuntimeSession): Promise<void>;
  get(runtimeId: string): RuntimeSession | undefined;
  list(filter?: RuntimeFilter): RuntimeSession[];
  update(runtimeId: string, patch: Partial<RuntimeSession>): void;
  remove(runtimeId: string): Promise<void>;
  persist(): Promise<void>;
  restore(): Promise<void>;
}
```

Responsibilities:

- create Atlas-managed runtimes
- register external runtimes such as `beam`
- persist runtime state
- update status and activity timestamps
- remove dead runtimes

Non-responsibilities:

- thread routing
- command parsing
- card rendering

### 6.2 BindingStore

`BindingStore` owns thread-to-runtime relationships and persistence.

```ts
interface BindingStore {
  get(bindingId: string): ConversationBinding | undefined;
  getOrCreate(channelId: string, chatId: string, threadKey: string): ConversationBinding;
  attach(bindingId: string, runtimeId: string): void;
  detach(bindingId: string, runtimeId: string): void;
  setActive(bindingId: string, runtimeId: string | null): void;
  setDefault(bindingId: string, runtimeId: string | null): void;
  persist(): Promise<void>;
  restore(): Promise<void>;
}
```

Responsibilities:

- create durable binding records
- attach and detach runtimes
- track active/default runtime selection
- preserve MRU ordering

### 6.3 RuntimeRouter

`RuntimeRouter` is a thin coordination layer that resolves routing decisions.

```ts
interface RuntimeRouter {
  resolveTarget(event: ChannelEvent): Promise<ResolvedRuntimeTarget>;
}
```

Responsibilities:

- derive binding ID from incoming channel events
- locate the active runtime for a thread
- decide whether to:
  - route to active runtime
  - use default runtime
  - create a new Atlas-managed runtime
  - ask the user to attach a runtime
- normalize routing errors into structured results

### 6.4 RuntimeBridge

`RuntimeBridge` becomes the gateway-facing bridge for runtime operations.

```ts
interface RuntimeBridge {
  sendPrompt(runtimeId: string, event: ChannelEvent): Promise<void>;
  cancel(runtimeId: string): Promise<void>;
  dispose(runtimeId: string): Promise<void>;
  respondToPermission(runtimeId: string, requestId: string, approved: boolean): Promise<void>;
}
```

Responsibilities:

- find the correct adapter for a runtime
- transform a channel event into a runtime prompt
- forward runtime events into the unified `AgentMessage` stream
- coordinate cancel/dispose/permission actions

### 6.5 RuntimeAdapter

All runtime sources must implement a common adapter boundary.

```ts
interface RuntimeAdapter {
  start(runtime: RuntimeSession): Promise<void>;
  sendPrompt(runtime: RuntimeSession, prompt: RuntimePrompt): Promise<void>;
  cancel(runtime: RuntimeSession): Promise<void>;
  resume?(runtime: RuntimeSession): Promise<void>;
  dispose(runtime: RuntimeSession): Promise<void>;
  onMessage(handler: (runtimeId: string, msg: AgentMessage) => void): void;
}
```

Expected concrete adapters:

- `AtlasClaudeRuntimeAdapter`
- `BeamRuntimeAdapter`
- `RemoteRuntimeAdapter`

Future external systems integrate at this boundary.

## 7. Message Flow

The new primary request flow is:

1. A channel adapter emits a `ChannelEvent`.
2. `Engine` parses message content and resolves commands first.
3. For non-command messages, `Engine` asks `RuntimeRouter` to resolve the target runtime.
4. `RuntimeRouter` computes `bindingId = channelId:chatId:threadKey`.
5. `BindingStore` returns the current binding.
6. `RuntimeRouter` resolves the runtime outcome:
   - use `activeRuntimeId`
   - or use `defaultRuntimeId`
   - or create a new Atlas-managed runtime if policy allows
   - or return a "no runtime attached" response
7. `RuntimeBridge.sendPrompt(runtimeId, event)` hands the prompt to the appropriate `RuntimeAdapter`.
8. The adapter emits unified `AgentMessage` events.
9. `CardEngine` renders streaming output, tool cards, permissions, and terminal output just as it does today.
10. `RuntimeRegistry` updates runtime timestamps and status.
11. `BindingStore` updates binding activity time.

The design deliberately keeps card rendering and channel delivery as they are, while replacing the underlying routing and runtime model.

## 8. Engine Responsibilities After Refactor

`Engine` becomes thinner.

It should only:

- parse incoming channel events
- resolve slash commands
- resolve the target runtime through `RuntimeRouter`
- delegate to `RuntimeBridge`
- handle card actions and route them to the runtime

It should no longer:

- create or own session records
- assume one gateway session equals one runtime
- mix routing state with runtime state

## 9. Command Semantics After Refactor

Commands are redefined around runtime and binding concepts.

### `/new`

Create a new Atlas-managed runtime for the current binding and switch the binding's active runtime to it.

It is not a destructive "reset session" command anymore.

### `/attach <id>`

Attach an existing runtime to the current binding and set it active.

### `/switch <id>`

Switch the active runtime inside the current binding.

### `/detach <id>`

Detach a runtime from the current binding without destroying the runtime.

### `/destroy`

Destroy the currently active runtime and remove it from the binding.

### `/sessions`

List runtimes attached to the current binding.

### `/list`

List current-chat bindings and discoverable runtimes relevant to that chat.

### `/agent <spec>`

Create a new runtime from the specified `AgentSpec` and switch the current binding to it.

## 10. Direct Migration Constraints

This refactor is a direct migration.

The following rules are explicit:

- Do not keep old `SessionManager` semantics as an active compatibility layer.
- Do not keep `ThreadContextStore` as the authoritative binding model.
- Do not keep `SessionInfo` as the primary runtime representation.
- Do not ship a dual-stack or fallback model.

Temporary adapters are acceptable only where needed to bridge old UI/card code during the implementation, but they must not remain as architectural source-of-truth objects.

## 11. Persistence Layout

Persist the new models in separate files:

- `runtime-sessions.json`
- `conversation-bindings.json`
- `projects.json`

This replaces the overloaded `sessions.json` approach.

Benefits:

- runtime lifecycle becomes independent of thread bindings
- bindings can survive process restarts
- external runtimes can be restored and rediscovered cleanly
- project grouping becomes explicit instead of inferred

## 12. External Runtime Registration

`beam` becomes one source of runtime registration, not a special session type.

The long-term API shape is generic external runtime registration, for example:

```http
POST /api/runtimes/register
{
  "source": "beam",
  "provider": "claude",
  "transport": "bridge",
  "displayName": "fix-bug",
  "resumeHandle": { "kind": "beam-session", "value": "uuid" },
  "workspaceId": "default"
}
```

This keeps the external integration surface aligned with the new runtime model.

## 13. Error Model

The refactor standardizes routing/runtime errors into explicit categories.

### `binding-not-found`

No runtime is attached to the current binding and no auto-create rule applies.

User-facing result:

- explain there is no active runtime
- guide the user to `/attach` or `/agent`

### `runtime-not-found`

The binding points to a runtime that no longer exists.

System behavior:

- detach the invalid runtime from the binding
- preserve the rest of the binding state
- return a recoverable message to the user

### `runtime-unavailable`

A runtime exists in the registry but cannot be resumed or started.

System behavior:

- mark the runtime as `error`
- keep it visible for inspection/retry
- do not silently delete it

### `capability-mismatch`

The runtime exists but does not support the requested action.

Examples:

- permission response sent to a runtime without approval support
- image input sent to a runtime with `imageInput: false`

System behavior:

- emit a structured explanatory message
- do not fail silently

## 14. Testing Boundaries

The test suite must be rebuilt around the new architectural seams.

### 14.1 RuntimeRegistry

Verify:

- create Atlas-managed runtime
- register external runtime
- update runtime status and timestamps
- persist and restore runtime data
- remove runtimes and handle invalid references

### 14.2 BindingStore

Verify:

- create binding
- attach/detach runtime
- switch active runtime
- preserve MRU ordering
- persist and restore binding state

### 14.3 RuntimeRouter

Verify:

- route to active runtime
- route to default runtime
- auto-create runtime when policy allows
- fail cleanly when no runtime is available
- recover cleanly when binding points to dead runtime

### 14.4 RuntimeBridge and RuntimeAdapter

Verify:

- correct runtime selection
- prompt forwarding
- permission response forwarding
- status update propagation
- cancel/dispose behavior
- unified `AgentMessage` emission

### 14.5 Engine and Commands

Verify:

- thread-scoped runtime routing
- `/attach`, `/switch`, `/detach`, `/destroy`, `/new`, `/sessions`, `/agent`
- card actions routed to the correct runtime
- runtime-driven streaming behavior still works

## 15. Expected File-Level Refactor

Expected major changes:

- replace `SessionManagerImpl` with `RuntimeRegistryImpl` and `BindingStoreImpl`
- replace `ThreadContextStoreImpl` with a durable binding store
- replace `AgentBridge` with `RuntimeBridge`
- introduce `RuntimeRouter`
- refactor command context away from `sessionManager`
- refactor `beam` registration endpoints into generic runtime registration endpoints
- keep `CardEngine`, `CardRenderPipeline`, and channel adapters largely intact, with only dependency rewiring

## 16. Design Principles

This refactor follows these principles:

- Runtime state is real and first-class.
- Routing state is separate from runtime state.
- Channel UX stays strong, but does not define the architecture.
- External runtimes are peers, not special-case hacks.
- Project/workspace identity exists in the model even if its UX stays minimal at first.
- Direct migration is acceptable if it reduces long-term conceptual debt.

## 17. Final Decision Summary

Atlas will be fully refactored to a dual-layer architecture built on:

- `RuntimeSession`
- `ConversationBinding`
- `RuntimeRegistry`
- `BindingStore`
- `RuntimeRouter`
- `RuntimeBridge`
- `RuntimeAdapter`

This replaces the current mixed session model and establishes a stable base for both Atlas-managed runtimes and externally hosted coding runtimes.
