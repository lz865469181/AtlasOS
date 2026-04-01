# Phase 5: Channel Expansion (DingTalk) + Multi-Adapter Engine + Config System

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan.

**Goal:** Validate the multi-channel architecture by adding DingTalk as the second channel adapter, then build a config system that supports multiple adapters declaratively.

**Preconditions:** Phases 1-4 complete. 528 tests passing. All 5 packages type-check clean.

**Architecture Decision:** The current Engine is single-adapter (one FeishuAdapter wired in createApp). Phase 5 evolves this to support N adapters, with DingTalk as the proof that the abstraction holds.

---

## Phase 5A: DingTalk Channel Adapter

### Task 1: DingTalk SDK types + HTTP client

**Files:**
- Create: `packages/atlas-gateway/src/channel/dingtalk/DingTalkClient.ts`
- Create: `packages/atlas-gateway/src/channel/dingtalk/DingTalkClient.test.ts`

**Design:**

DingTalk has two messaging modes:
1. **Session Webhook** — reply-only webhook URL per incoming message (used in robot callback)
2. **OpenAPI** — full send/update via access token (requires appKey/appSecret auth)

We need both: session webhook for fast replies, OpenAPI for proactive sends and card updates.

```typescript
export interface DingTalkClientConfig {
  appKey: string;
  appSecret: string;
}

export interface DingTalkClient {
  /** Get or refresh the access token (cached, auto-refresh). */
  getAccessToken(): Promise<string>;

  /** Send text via OpenAPI to a conversation. */
  sendText(conversationId: string, text: string): Promise<string>;

  /** Send markdown via OpenAPI to a conversation. */
  sendMarkdown(conversationId: string, title: string, text: string): Promise<string>;

  /** Send ActionCard (interactive card) via OpenAPI. */
  sendActionCard(conversationId: string, card: DingTalkActionCard): Promise<string>;

  /** Update a message (DingTalk supports limited update via OpenAPI). */
  updateCard(messageId: string, card: DingTalkActionCard): Promise<void>;

  /** Send via session webhook (reply-only, no auth needed). */
  sendViaWebhook(webhookUrl: string, payload: unknown): Promise<void>;
}

export interface DingTalkActionCard {
  title: string;
  text: string;  // Markdown content
  btnOrientation?: '0' | '1';  // 0=vertical, 1=horizontal
  btns?: Array<{ title: string; actionURL: string }>;
  singleTitle?: string;
  singleURL?: string;
}
```

**Implementation:**
- `DingTalkClientImpl` wraps `node:https` (no external dep needed)
- Token cache: store accessToken + expiry, refresh 60s before expiry
- All methods return Promise; errors are typed

**Tests:**
- Token caching: mock https, verify second call uses cache
- Token refresh: advance clock past expiry, verify re-fetches
- sendViaWebhook: verify POST body matches payload
- Error handling: non-200 response throws

### Task 2: DingTalk message event types

**Files:**
- Create: `packages/atlas-gateway/src/channel/dingtalk/types.ts`

**Design:**

Define the incoming message shape from DingTalk Stream/Webhook:

```typescript
/** Incoming message from DingTalk robot callback. */
export interface DingTalkMessageEvent {
  msgtype: string;
  text?: { content: string };
  senderStaffId: string;
  senderNick?: string;
  conversationId: string;
  conversationType: '1' | '2';  // 1=p2p, 2=group
  chatbotCorpId?: string;
  chatbotUserId?: string;
  sessionWebhook: string;
  sessionWebhookExpiredTime: number;
  msgId: string;
  createAt?: number;
  isInAtList?: boolean;
  atUsers?: Array<{
    dingtalkId: string;
    staffId?: string;
  }>;
}

/** DingTalk Stream event wrapper. */
export interface DingTalkStreamEvent {
  specVersion: string;
  type: string;
  headers: Record<string, string>;
  data: string;  // JSON-encoded DingTalkMessageEvent
}

/** Card action callback from DingTalk interactive card. */
export interface DingTalkCardActionEvent {
  corpId?: string;
  chatbotCorpId?: string;
  chatbotUserId?: string;
  msgId?: string;
  conversationId?: string;
  senderStaffId?: string;
  value?: Record<string, unknown>;
}
```

No tests needed — pure type definitions.

### Task 3: DingTalkCardRenderer

**Files:**
- Create: `packages/atlas-gateway/src/channel/dingtalk/DingTalkCardRenderer.ts`
- Create: `packages/atlas-gateway/src/channel/dingtalk/DingTalkCardRenderer.test.ts`

**Design:**

DingTalk interactive cards use ActionCard format. CardModel needs to map to DingTalk's markdown subset.

```typescript
import type { CardModel } from '../../cards/CardModel.js';
import type { CardRenderer } from '../../engine/CardRenderPipeline.js';

export class DingTalkCardRenderer implements CardRenderer {
  render(card: CardModel, context: { status: string; type: string }): CardModel {
    // Pass-through with status decoration (same pattern as Feishu)
    return card;
  }

  /** Convert CardModel → DingTalk ActionCard markdown. */
  toActionCard(card: CardModel): DingTalkActionCard { ... }

  /** Convert CardModel → plain markdown (fallback for session webhook). */
  toMarkdown(card: CardModel): string { ... }
}
```

**Key differences from Feishu:**
- DingTalk markdown: no `<column_set>`, limited formatting
- Fields rendered as `**label**: value` lines
- Actions → ActionCard buttons (title + actionURL) or single-button card
- No `updateCard` via webhook — only via OpenAPI with limited support
- Card update is "replace entire card" not partial patch

**Tests:**
- Minimal card → markdown output
- Full card with header/sections/actions → ActionCard
- Fields → `**label**: value` format
- Actions → btns array

### Task 4: DingTalkAdapter + DingTalkChannelSender

**Files:**
- Create: `packages/atlas-gateway/src/channel/dingtalk/DingTalkAdapter.ts`
- Create: `packages/atlas-gateway/src/channel/dingtalk/DingTalkAdapter.test.ts`

**Design:**

```typescript
export interface DingTalkAdapterConfig {
  appKey: string;
  appSecret: string;
  /** Use Stream mode (real-time) or HTTP callback mode. */
  mode: 'stream' | 'webhook';
  /** Max dedup set size. Defaults to 1000. */
  dedupMax?: number;
  /** Max age (ms) for incoming messages. Defaults to 120000. */
  maxAgeMs?: number;
}

export class DingTalkChannelSender implements ChannelSender {
  constructor(
    private client: DingTalkClient,
    private chatId: string,
    private renderer: DingTalkCardRenderer,
    private sessionWebhook?: string,  // For fast reply via webhook
  ) {}

  async sendText(text: string, replyTo?: string): Promise<string> { ... }
  async sendMarkdown(md: string, replyTo?: string): Promise<string> { ... }
  async sendCard(card: CardModel, replyTo?: string): Promise<string> { ... }
  async updateCard(messageId: string, card: CardModel): Promise<void> { ... }
}

export class DingTalkAdapter implements ChannelAdapter {
  readonly id = 'dingtalk';

  constructor(opts: {
    config: DingTalkAdapterConfig;
    client: DingTalkClient;
    streamClientFactory?: (...) => DingTalkStreamClient;
    onCardAction?: (event: CardActionEvent) => Promise<void>;
  }) {}

  async start(handler: MessageHandler): Promise<void> { ... }
  async stop(): Promise<void> { ... }
  getSender(chatId: string): ChannelSender { ... }
}
```

**Key architectural decisions:**
1. **Session webhook cache**: DingTalk provides a `sessionWebhook` per message with TTL. Store `Map<conversationId, { url, expiry }>` so the sender can use webhook for fast reply, falling back to OpenAPI when expired.
2. **Dedup**: Reuse `DedupSet` from feishu module (extract to shared or duplicate — prefer extract).
3. **Stream mode**: DingTalk Stream SDK (`dingtalk-stream`) is an optional dependency. The adapter works in webhook mode without it.
4. **Card actions**: DingTalk card actions come via a separate callback URL. The adapter registers a handler same as Feishu.

**Tests:**
- `toChannelEvent`: Convert DingTalkMessageEvent → ChannelEvent (text, group/p2p)
- Dedup: second identical msgId is skipped
- Stale message filter: old messages skipped
- Session webhook caching: verify fast-reply path used when fresh
- Card action mapping: DingTalkCardActionEvent → CardActionEvent

### Task 5: DingTalk barrel exports

**Files:**
- Create: `packages/atlas-gateway/src/channel/dingtalk/index.ts`
- Modify: `packages/atlas-gateway/src/channel/index.ts`

```typescript
// packages/atlas-gateway/src/channel/dingtalk/index.ts
export { DingTalkAdapter, DingTalkChannelSender } from './DingTalkAdapter.js';
export { DingTalkCardRenderer } from './DingTalkCardRenderer.js';
export { DingTalkClientImpl } from './DingTalkClient.js';
export type { DingTalkClient, DingTalkClientConfig, DingTalkActionCard } from './DingTalkClient.js';
export type { DingTalkAdapterConfig } from './DingTalkAdapter.js';
export type * from './types.js';
```

```typescript
// packages/atlas-gateway/src/channel/index.ts — add:
export * from './dingtalk/index.js';
```

### Task 6: Extract shared DedupSet

**Files:**
- Create: `packages/atlas-gateway/src/channel/DedupSet.ts`
- Modify: `packages/atlas-gateway/src/channel/feishu/FeishuAdapter.ts` (import from shared)
- Modify: `packages/atlas-gateway/src/channel/dingtalk/DingTalkAdapter.ts` (import from shared)

The `DedupSet` class is currently defined inside FeishuAdapter.ts. Extract it to a shared location so DingTalk (and future adapters) can reuse it.

**Changes:**
1. Move `DedupSet` class + `isStaleMessage` function to `channel/DedupSet.ts`
2. Re-export from FeishuAdapter.ts for backward compatibility
3. Import in DingTalkAdapter.ts

---

## Phase 5B: Multi-Adapter Engine

### Task 7: Evolve Engine to support multiple adapters

**Files:**
- Modify: `packages/atlas-gateway/src/engine/Engine.ts`
- Modify: `packages/atlas-gateway/src/engine/Engine.test.ts`

**Current:** Engine receives events from a single adapter via `handleChannelEvent`. The adapter is wired externally in createApp.

**Target:** Engine doesn't need to change much — it's already adapter-agnostic. The key change is in createApp: we need to wire N adapters, each calling `engine.handleChannelEvent` and `engine.handleCardAction`.

**What actually changes in Engine:**
- Nothing structural. Engine already works with `ChannelEvent` (channel-agnostic).
- The `senderFactory` needs to route to the correct adapter's sender based on `channelId`.

**SenderFactory routing:**

```typescript
// In createApp or a new AdapterRegistry:
const adapterMap = new Map<string, ChannelAdapter>();

const senderFactory: SenderFactory = (chatId: string) => {
  // Lookup which adapter owns this chatId
  // Option A: chatId is prefixed with channelId (e.g., "feishu:oc_xxx")
  // Option B: maintain a chatId → channelId mapping
  // Option C: store channelId in SessionInfo
  ...
};
```

**Decision: Option C — store channelId in SessionInfo.**

This is the cleanest approach:
- SessionManager already stores `chatId` per session
- Add `channelId: string` to SessionInfo
- When `getOrCreate` is called, pass `channelId` from the event
- SenderFactory looks up session → channelId → adapter → getSender(chatId)

**Changes:**
1. Add `channelId` to `SessionInfo` in SessionManager.ts
2. Update `getOrCreate(chatId, channelId?)` — store channelId on creation
3. Update Engine.handleChannelEvent to pass `event.channelId` to getOrCreate
4. SenderFactory becomes channelId-aware (injected from createApp)

### Task 8: Update SessionManager for channelId

**Files:**
- Modify: `packages/atlas-gateway/src/engine/SessionManager.ts`
- Modify: `packages/atlas-gateway/src/engine/SessionManager.test.ts`

**Changes:**
1. Add `channelId: string` to `SessionInfo` (default: `'feishu'` for backward compat)
2. `getOrCreate(chatId: string, channelId?: string)` — passes channelId on new session
3. Update tests

### Task 9: Wire multiple adapters in createApp

**Files:**
- Modify: `packages/atlas-cli/src/createApp.ts`
- Modify: `packages/atlas-cli/src/createApp.test.ts`

**New config shape:**

```typescript
export interface AppConfig {
  feishu?: {
    appId: string;
    appSecret: string;
  };
  dingtalk?: {
    appKey: string;
    appSecret: string;
    mode?: 'stream' | 'webhook';
  };
  agentCwd: string;
  agentEnv?: Record<string, string>;
}
```

**Changes:**
1. Create adapters conditionally based on config
2. SenderFactory routes via channelId → adapter map
3. Start all adapters, each with `engine.handleChannelEvent` handler
4. Stop all adapters on shutdown

---

## Phase 5C: Config System

### Task 10: Config schema with Zod validation

**Files:**
- Create: `packages/atlas-gateway/src/config/ConfigSchema.ts`
- Create: `packages/atlas-gateway/src/config/ConfigSchema.test.ts`

**Design:**

```typescript
import * as z from 'zod';

export const FeishuChannelConfigSchema = z.object({
  appId: z.string().min(1),
  appSecret: z.string().min(1),
  verificationToken: z.string().optional(),
});

export const DingTalkChannelConfigSchema = z.object({
  appKey: z.string().min(1),
  appSecret: z.string().min(1),
  mode: z.enum(['stream', 'webhook']).default('stream'),
});

export const AgentConfigSchema = z.object({
  cwd: z.string().default('.'),
  env: z.record(z.string(), z.string()).optional(),
  defaultAgent: z.string().default('claude'),
  defaultModel: z.string().optional(),
  defaultPermissionMode: z.enum([
    'auto', 'confirm', 'deny',
  ]).default('auto'),
});

export const AtlasConfigSchema = z.object({
  channels: z.object({
    feishu: FeishuChannelConfigSchema.optional(),
    dingtalk: DingTalkChannelConfigSchema.optional(),
  }),
  agent: AgentConfigSchema.default({}),
  idleTimeoutMs: z.number().default(10 * 60 * 1000),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type AtlasConfig = z.infer<typeof AtlasConfigSchema>;
```

**Tests:**
- Valid full config parses
- Missing channels → empty object
- Invalid appId (empty string) → throws
- Defaults applied correctly
- Env override merging

### Task 11: Config loader (env + file + overrides)

**Files:**
- Create: `packages/atlas-gateway/src/config/ConfigLoader.ts`
- Create: `packages/atlas-gateway/src/config/ConfigLoader.test.ts`

**Design:**

Config resolution order (later overrides earlier):
1. **File**: `atlas.config.json` or `atlas.config.ts` in CWD
2. **Environment variables**: `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `DINGTALK_APP_KEY`, etc.
3. **Runtime overrides**: passed programmatically

```typescript
export interface ConfigLoaderOptions {
  /** Path to config file. If omitted, searches CWD. */
  configPath?: string;
  /** Runtime overrides (highest priority). */
  overrides?: Partial<AtlasConfig>;
}

export class ConfigLoader {
  /**
   * Load and validate config from all sources.
   * Returns a validated AtlasConfig.
   */
  static async load(opts?: ConfigLoaderOptions): Promise<AtlasConfig> { ... }

  /** Build config from environment variables only. */
  static fromEnv(env?: Record<string, string | undefined>): Partial<AtlasConfig> { ... }

  /** Read config file if it exists. */
  static async fromFile(path?: string): Promise<Partial<AtlasConfig> | null> { ... }

  /** Deep merge configs with override priority. */
  static merge(...configs: Array<Partial<AtlasConfig>>): AtlasConfig { ... }
}
```

**Env mapping:**
| Env Variable | Config Path |
|---|---|
| `FEISHU_APP_ID` | `channels.feishu.appId` |
| `FEISHU_APP_SECRET` | `channels.feishu.appSecret` |
| `DINGTALK_APP_KEY` | `channels.dingtalk.appKey` |
| `DINGTALK_APP_SECRET` | `channels.dingtalk.appSecret` |
| `AGENT_CWD` | `agent.cwd` |
| `ATLAS_LOG_LEVEL` | `logLevel` |
| `ATLAS_IDLE_TIMEOUT` | `idleTimeoutMs` |

**Tests:**
- fromEnv with all vars set
- fromEnv with partial vars (only feishu)
- fromFile with valid JSON
- merge: later source overrides earlier
- load: validates final result

### Task 12: Migrate atlas-cli to use ConfigLoader

**Files:**
- Modify: `packages/atlas-cli/src/index.ts`
- Modify: `packages/atlas-cli/src/createApp.ts`

**Changes:**
1. Replace hardcoded env reading with `ConfigLoader.load()`
2. createApp accepts `AtlasConfig` instead of `AppConfig`
3. Conditional adapter creation based on `config.channels`

### Task 13: Config barrel exports

**Files:**
- Create: `packages/atlas-gateway/src/config/index.ts`
- Modify: `packages/atlas-gateway/src/index.ts`

---

## Execution Order

```
Task 1-2  (DingTalk client + types)     ─┐
Task 3    (DingTalk card renderer)       ─┤ Can parallelize
Task 6    (Extract shared DedupSet)      ─┘
                                          │
Task 4-5  (DingTalk adapter + exports)   ─── Depends on 1-3, 6
                                          │
Task 7-8  (Multi-adapter engine)         ─── Depends on 4 (needs DingTalk to test)
                                          │
Task 10   (Config schema)               ─── Independent, can start early
Task 11   (Config loader)               ─── Depends on 10
                                          │
Task 9    (Wire createApp)              ─── Depends on 7, 8, 11
Task 12   (Migrate atlas-cli)           ─── Depends on 9, 11
Task 13   (Barrel exports)              ─── Last
```

## Verification Criteria (Definition of Done)

### Per-task:
- [ ] All new code has unit tests
- [ ] `npx tsc --noEmit` clean across all packages
- [ ] `npx vitest run` passes in atlas-gateway
- [ ] `npx vitest run` passes in atlas-cli

### Phase 5A (DingTalk adapter):
- [ ] DingTalkAdapter converts DingTalkMessageEvent → ChannelEvent correctly
- [ ] DingTalkChannelSender sends text/markdown/card via webhook and OpenAPI
- [ ] DingTalkCardRenderer produces valid DingTalk ActionCard markdown
- [ ] Dedup and stale message filter work identically to Feishu
- [ ] Card action events flow through to engine.handleCardAction

### Phase 5B (Multi-adapter):
- [ ] Engine handles events from both Feishu and DingTalk simultaneously
- [ ] SenderFactory resolves correct adapter based on channelId in session
- [ ] SessionInfo includes channelId, persisted correctly
- [ ] Existing Feishu-only tests still pass (backward compat)

### Phase 5C (Config):
- [ ] Config schema validates all channel configs
- [ ] ConfigLoader reads from file, env, and runtime overrides
- [ ] atlas-cli boots with either Feishu-only, DingTalk-only, or both
- [ ] Missing channel config = adapter not started (no crash)

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| DingTalk Stream SDK not available | Webhook mode as primary; Stream mode optional |
| DingTalk card update limitations | Fallback: re-send new message instead of update |
| DingTalk markdown subset | DingTalkCardRenderer handles graceful degradation |
| Session webhook expiry | Cache with TTL, fallback to OpenAPI |
| Breaking existing Feishu flow | channelId defaults to 'feishu', all existing tests unchanged |

## Estimated Scope

| Phase | Tasks | New Files | Modified Files | Est. Tests |
|-------|-------|-----------|---------------|------------|
| 5A | 6 | ~8 | 3 | ~60 |
| 5B | 3 | 0 | 5 | ~15 |
| 5C | 4 | ~4 | 3 | ~25 |
| **Total** | **13** | **~12** | **~11** | **~100** |
