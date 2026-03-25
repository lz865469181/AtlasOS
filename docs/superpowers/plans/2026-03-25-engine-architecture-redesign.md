# Engine Architecture Redesign — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure feishu-ai-assistant from a flat router pattern to an Engine-based orchestrator with Agent/AgentSession interfaces, interactive permissions, and consolidated utilities — while deleting dead code and duplications.

**Architecture:** Engine class as central orchestrator owning session state machine, permission flow, streaming preview, and command dispatch. Agent/AgentSession interfaces with factory registry replace the backend/ layer. Provider routing inside agents for model selection. Hybrid session model: persistent process for Claude Code, per-turn subprocess for others.

**Tech Stack:** TypeScript (ES2022, NodeNext), Node.js, Lark SDK, optional discord.js/node-telegram-bot-api

**Spec:** `docs/superpowers/specs/2026-03-25-engine-architecture-redesign.md`

---

## Chunk 1: Foundation — Shared Utilities + Core Interfaces

### Task 1: Create shared logger and utilities

**Files:**
- Create: `src/core/logger.ts`
- Create: `src/core/utils.ts`

- [ ] **Step 1: Create `src/core/logger.ts`**

```typescript
// src/core/logger.ts
export function log(level: string, msg: string, meta?: Record<string, unknown>): void {
  const entry = { time: new Date().toISOString(), level, msg, ...meta };
  console.log(JSON.stringify(entry));
}

export function redactToken(token: string): string {
  if (token.length <= 8) return "***";
  return token.slice(0, 4) + "..." + token.slice(-4);
}
```

- [ ] **Step 2: Create `src/core/utils.ts`**

```typescript
// src/core/utils.ts
import { writeFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";

/**
 * Async line iterator for a ReadableStream (shared across all agent backends).
 * Replaces 4 duplicated copies in claude/client.ts, backend/codex.ts, backend/gemini.ts, backend/cursor.ts.
 */
export async function* createLineIterator(stream: NodeJS.ReadableStream): AsyncGenerator<string> {
  let buffer = "";
  for await (const chunk of stream) {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) yield line;
    }
  }
  if (buffer.trim()) yield buffer;
}

/**
 * Atomic file write: write to temp file, then rename.
 */
export function atomicWriteFile(filePath: string, data: string): void {
  const tmp = filePath + ".tmp." + process.pid;
  writeFileSync(tmp, data, "utf-8");
  renameSync(tmp, filePath);
}

/**
 * Estimate token count from text (~3.5 chars per token).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}
```

- [ ] **Step 3: Verify files compile**

Run: `npx tsc --noEmit src/core/logger.ts src/core/utils.ts`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/core/logger.ts src/core/utils.ts
git commit -m "feat: add core/logger and core/utils (consolidate duplicated utilities)"
```

---

### Task 2: Create Agent/AgentSession interfaces + registry

**Files:**
- Create: `src/agent/types.ts`
- Create: `src/agent/registry.ts`

- [ ] **Step 1: Create `src/agent/types.ts`**

```typescript
// src/agent/types.ts

/** Options for starting a new agent session. */
export interface AgentSessionOpts {
  sessionId?: string;        // Resume existing session
  workDir: string;           // Working directory
  model?: string;            // Model override
  mode?: string;             // Permission mode (default, yolo, plan, etc.)
  env?: Record<string, string>;  // Extra environment variables
  systemPrompt?: string;     // Injected system prompt
  continueSession?: boolean; // Resume most recent session (first connection)
}

/** Information about an existing session. */
export interface SessionInfo {
  id: string;
  name?: string;
  cwd?: string;
  lastActive?: number;
}

/** Token usage from a completed turn. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Question in an AskUserQuestion permission request. */
export interface AskQuestion {
  question: string;
  options?: string[];
  multiSelect?: boolean;
}

/** Events emitted by an agent session. */
export type AgentEvent =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "tool_use"; tool: string; input: string }
  | { type: "tool_result"; tool: string; output: string }
  | { type: "permission_request"; id: string; tool: string; input: string; questions?: AskQuestion[] }
  | { type: "result"; content: string; sessionId?: string; usage?: TokenUsage }
  | { type: "error"; message: string };

/** A running agent session — bidirectional communication with a CLI agent. */
export interface AgentSession {
  /** Unique session identifier. */
  readonly sessionId: string;
  /** Send a user message to the agent. */
  send(prompt: string): Promise<void>;
  /** Respond to a pending permission request. */
  respondPermission(allowed: boolean, message?: string): void;
  /** Async iterable of events from the agent. */
  events(): AsyncIterable<AgentEvent>;
  /** Close the session and kill the underlying process. */
  close(): Promise<void>;
}

/** Agent adapter — manages lifecycle and session creation for one CLI agent type. */
export interface Agent {
  /** Agent type name (e.g., "claude", "codex", "gemini"). */
  readonly name: string;
  /** Start a new interactive session. */
  startSession(opts: AgentSessionOpts): Promise<AgentSession>;
  /** List existing sessions for the given work directory. */
  listSessions(workDir: string): Promise<SessionInfo[]>;
  /** Stop the agent (cleanup). */
  stop(): Promise<void>;
}

// ─── Optional Capability Interfaces ──────────────────────────────────────────

export interface ModelSwitcher {
  setModel(model: string): void;
  availableModels(): Promise<Record<string, string>>;
  currentModel(): string;
}

export interface ModeSwitcher {
  setMode(mode: string): void;
  availableModes(): string[];
  currentMode(): string;
}

export interface LiveModeSwitcher {
  setLiveMode(mode: string): Promise<void>;
}

export interface ProviderSwitcher {
  setProviders(providers: ProviderConfig[]): void;
  setActiveProvider(name: string): void;
  currentProvider(): string;
}

export interface MemoryFileProvider {
  projectMemoryFile(): string;
  globalMemoryFile(): string;
}

export interface CommandProvider {
  commandDirs(): string[];
}

export interface SkillProvider {
  skillDirs(): string[];
}

export interface ContextCompressor {
  compactCommand(): string;
}

export interface UsageReporter {
  lastUsage(): TokenUsage | undefined;
}

export interface FormattingInstructionProvider {
  formattingInstructions(platform: string): string;
}

// ─── Provider Config ─────────────────────────────────────────────────────────

export interface ProviderConfig {
  name: string;
  type: "cli" | "api";
  model: string;
  baseUrl?: string;
  apiKey?: string;
  thinking?: { type: string; budgetTokens?: number };
  env?: Record<string, string>;
}

// ─── Capability Detection Helpers ────────────────────────────────────────────

export function supportsModelSwitching(agent: Agent): agent is Agent & ModelSwitcher {
  return "setModel" in agent && "availableModels" in agent;
}

export function supportsModeSwitching(agent: Agent): agent is Agent & ModeSwitcher {
  return "setMode" in agent && "availableModes" in agent;
}

export function supportsLiveModeSwitching(session: AgentSession): session is AgentSession & LiveModeSwitcher {
  return "setLiveMode" in session;
}

export function supportsProviderSwitching(agent: Agent): agent is Agent & ProviderSwitcher {
  return "setProviders" in agent && "setActiveProvider" in agent;
}

export function supportsMemoryFiles(agent: Agent): agent is Agent & MemoryFileProvider {
  return "projectMemoryFile" in agent && "globalMemoryFile" in agent;
}

export function supportsContextCompression(agent: Agent): agent is Agent & ContextCompressor {
  return "compactCommand" in agent;
}
```

- [ ] **Step 2: Create `src/agent/registry.ts`**

```typescript
// src/agent/registry.ts
import type { Agent } from "./types.js";

export type AgentFactory = (options: Record<string, unknown>) => Agent;

const factories = new Map<string, AgentFactory>();

/** Register an agent factory. Called in agent init modules. */
export function registerAgent(name: string, factory: AgentFactory): void {
  factories.set(name, factory);
}

/** Create an agent by name from the registry. */
export function createAgent(name: string, options: Record<string, unknown> = {}): Agent {
  const factory = factories.get(name);
  if (!factory) {
    throw new Error(`Unknown agent: "${name}". Available: ${[...factories.keys()].join(", ")}`);
  }
  return factory(options);
}

/** List all registered agent names. */
export function registeredAgents(): string[] {
  return [...factories.keys()];
}
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors (these files are standalone with no imports from old code)

- [ ] **Step 4: Commit**

```bash
git add src/agent/types.ts src/agent/registry.ts
git commit -m "feat: add agent/types (Agent/AgentSession interfaces) and agent/registry (factory pattern)"
```

---

### Task 3: Create slim platform types + registry

**Files:**
- Create: `src/core/interfaces.ts`
- Update: `src/platform/types.ts` (will be gradually replaced; for now keep existing)
- Update: `src/platform/registry.ts` (add factory pattern alongside existing)

- [ ] **Step 1: Create `src/core/interfaces.ts`** — unified capability interfaces shared by core

```typescript
// src/core/interfaces.ts
// Re-export agent types so core/ consumers don't import from agent/
export type {
  Agent, AgentSession, AgentEvent, AgentSessionOpts,
  TokenUsage, AskQuestion, SessionInfo, ProviderConfig,
  ModelSwitcher, ModeSwitcher, LiveModeSwitcher, ProviderSwitcher,
  MemoryFileProvider, CommandProvider, SkillProvider,
  ContextCompressor, UsageReporter, FormattingInstructionProvider,
} from "../agent/types.js";

// Re-export platform types so core/ consumers don't import from platform/
export type {
  MessageEvent, PlatformSender, MessageHandler, PlatformAdapter,
  CardActionEvent, CardActionHandler, Attachment,
  InlineButtonSender, ImageSender, FileSender, AudioSender,
  TypingIndicator, MessageUpdater, ButtonOption,
} from "../platform/types.js";

// Re-export capability detection helpers
export {
  supportsModelSwitching, supportsModeSwitching, supportsLiveModeSwitching,
  supportsProviderSwitching, supportsMemoryFiles, supportsContextCompression,
} from "../agent/types.js";

export {
  supportsInlineButtons, supportsImages, supportsFiles,
  supportsAudio, supportsTyping,
} from "../platform/types.js";

// ─── Reply Context ───────────────────────────────────────────────────────────

/** Platform-agnostic reply routing info. */
export interface ReplyContext {
  platform: string;
  chatID: string;
  chatType: "p2p" | "group";
  userID: string;
  messageID?: string;
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/core/interfaces.ts
git commit -m "feat: add core/interfaces.ts (unified re-exports for capability interfaces)"
```

---

### Task 4: Create core/cards.ts (platform-agnostic card model)

**Files:**
- Create: `src/core/cards.ts`

- [ ] **Step 1: Create `src/core/cards.ts`**

Move the Card model, CardBuilder, renderCardAsText, and collectCardButtons from `src/platform/types.ts` into `src/core/cards.ts`. The platform/types.ts will re-export them for backward compatibility during migration.

```typescript
// src/core/cards.ts

export type CardHeaderColor = "blue" | "green" | "orange" | "red" | "purple" | "grey";

export interface CardHeader {
  title: string;
  color?: CardHeaderColor;
}

export interface CardButton {
  text: string;
  value: string;
  type?: "primary" | "default" | "danger";
  extra?: Record<string, unknown>;
}

export type CardElement =
  | { type: "markdown"; content: string }
  | { type: "divider" }
  | { type: "actions"; buttons: CardButton[] }
  | { type: "note"; content: string }
  | { type: "list_item"; text: string; button?: CardButton };

export interface Card {
  header?: CardHeader;
  elements: CardElement[];
}

/** Fluent card builder. */
export class CardBuilder {
  private header?: CardHeader;
  private elements: CardElement[] = [];

  title(text: string, color?: CardHeaderColor): this {
    this.header = { title: text, color };
    return this;
  }

  markdown(content: string): this {
    this.elements.push({ type: "markdown", content });
    return this;
  }

  divider(): this {
    this.elements.push({ type: "divider" });
    return this;
  }

  buttons(buttons: CardButton[]): this {
    this.elements.push({ type: "actions", buttons });
    return this;
  }

  note(content: string): this {
    this.elements.push({ type: "note", content });
    return this;
  }

  listItem(text: string, button?: CardButton): this {
    this.elements.push({ type: "list_item", text, button });
    return this;
  }

  build(): Card {
    return { header: this.header, elements: this.elements };
  }
}

/** Render a card to plain text (fallback for platforms without card support). */
export function renderCardAsText(card: Card): string {
  const lines: string[] = [];
  if (card.header) lines.push(`**${card.header.title}**`);
  for (const el of card.elements) {
    switch (el.type) {
      case "markdown":
        lines.push(el.content);
        break;
      case "divider":
        lines.push("───");
        break;
      case "actions":
        lines.push(el.buttons.map((b) => `[${b.text}]`).join("  "));
        break;
      case "note":
        lines.push(`> ${el.content}`);
        break;
      case "list_item":
        lines.push(`• ${el.text}${el.button ? ` [${el.button.text}]` : ""}`);
        break;
    }
  }
  return lines.join("\n");
}

/** Extract all buttons from a card (for InlineButtonSender). */
export function collectCardButtons(card: Card): CardButton[] {
  const buttons: CardButton[] = [];
  for (const el of card.elements) {
    if (el.type === "actions") buttons.push(...el.buttons);
    if (el.type === "list_item" && el.button) buttons.push(el.button);
  }
  return buttons;
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/core/cards.ts
git commit -m "feat: add core/cards.ts (platform-agnostic card model + builder)"
```

---

### Task 5: Create core/dedup.ts (message deduplication)

**Files:**
- Create: `src/core/dedup.ts`

- [ ] **Step 1: Create `src/core/dedup.ts`**

```typescript
// src/core/dedup.ts

/** Message deduplication with TTL-based expiry. */
export class MessageDedup {
  private seen = new Map<string, number>();
  private timer: ReturnType<typeof setInterval>;

  constructor(private ttlMs: number = 60_000) {
    this.timer = setInterval(() => this.cleanup(), 30_000);
  }

  /** Returns true if this message ID has been seen within TTL. */
  isDuplicate(messageID: string): boolean {
    const now = Date.now();
    if (this.seen.has(messageID)) return true;
    this.seen.set(messageID, now);
    return false;
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, ts] of this.seen) {
      if (ts < cutoff) this.seen.delete(id);
    }
  }

  dispose(): void {
    clearInterval(this.timer);
  }
}

/** Check if a message timestamp is from before the process started. */
const processStartTime = Date.now();

export function isOldMessage(timestampMs: number, graceMs: number = 2000): boolean {
  return timestampMs < processStartTime - graceMs;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/dedup.ts
git commit -m "feat: add core/dedup.ts (message deduplication + stale message filter)"
```

---

### Task 6: Migrate session management to core/session/

**Files:**
- Create: `src/core/session/manager.ts` (from `src/session/manager.ts`)
- Create: `src/core/session/queue.ts` (from `src/session/queue.ts`)
- Create: `src/core/session/state.ts` (NEW — interactive state per session)
- Create: `src/core/session/index.ts`

- [ ] **Step 1: Copy and adapt `src/session/manager.ts` → `src/core/session/manager.ts`**

Keep the existing SessionManager logic (Map-based, TTL cleanup, JSON persistence, debounced saves). Remove the `Session` class dependency — SessionManager now only stores lightweight session metadata (id, userID, agentID, model, cliSessionId, lastActive). The conversation history moves into InteractiveState.

- [ ] **Step 2: Copy `src/session/queue.ts` → `src/core/session/queue.ts`**

No changes needed — the promise-chain serial queue is already clean.

- [ ] **Step 3: Create `src/core/session/state.ts`**

```typescript
// src/core/session/state.ts
import type { AgentSession, AskQuestion } from "../../agent/types.js";
import type { ReplyContext } from "../interfaces.js";

/** Pending permission request awaiting user response. */
export interface PendingPermission {
  requestId: string;
  tool: string;
  input: string;
  questions?: AskQuestion[];
  resolve: (allowed: boolean, message?: string) => void;
  resolved: boolean;
}

/** Queued message received while session is busy. */
export interface QueuedMessage {
  text: string;
  timestamp: number;
}

/** Per-session runtime state — tracks the active agent session and its UI state. */
export interface InteractiveState {
  sessionKey: string;
  agentSession: AgentSession;
  replyCtx: ReplyContext;
  pending?: PendingPermission;
  pendingMessages: QueuedMessage[];
  approveAll: boolean;
  quiet: boolean;
  lastActivity: number;
}

export const MAX_QUEUED_MESSAGES = 5;
```

- [ ] **Step 4: Create `src/core/session/index.ts`**

```typescript
export { SessionManager } from "./manager.js";
export { SessionQueue } from "./queue.js";
export type { InteractiveState, PendingPermission, QueuedMessage } from "./state.js";
export { MAX_QUEUED_MESSAGES } from "./state.js";
```

- [ ] **Step 5: Verify compilation**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add src/core/session/
git commit -m "feat: add core/session/ (manager, queue, interactive state)"
```

---

### Task 7: Create core/streaming.ts (stream preview manager)

**Files:**
- Create: `src/core/streaming.ts`

- [ ] **Step 1: Create `src/core/streaming.ts`**

```typescript
// src/core/streaming.ts
import type { PlatformSender } from "./interfaces.js";

export interface StreamPreviewConfig {
  intervalMs: number;      // Min time between updates (default 1500)
  minDeltaChars: number;   // Min chars changed before update (default 300)
  maxChars: number;        // Max chars to preview (default 4000)
}

const DEFAULT_CONFIG: StreamPreviewConfig = {
  intervalMs: 1500,
  minDeltaChars: 300,
  maxChars: 4000,
};

/**
 * Manages progressive message updates for streaming agent output.
 * Sends throttled edits to a platform message, creating the illusion of real-time typing.
 */
export class StreamPreview {
  private buffer = "";
  private lastSent = "";
  private lastSentAt = 0;
  private messageId?: string;
  private frozen = false;
  private timer?: ReturnType<typeof setTimeout>;
  private config: StreamPreviewConfig;

  constructor(
    private chatID: string,
    private sender: PlatformSender,
    config?: Partial<StreamPreviewConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Append text to the buffer. Schedules a throttled update. */
  append(text: string): void {
    this.buffer += text;
    if (!this.frozen) this.scheduleUpdate();
  }

  /** Pause updates (e.g., during permission prompts). */
  freeze(): void {
    this.frozen = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /** Resume updates after freeze. */
  unfreeze(): void {
    this.frozen = false;
    this.scheduleUpdate();
  }

  /** Discard buffered content (abort). */
  discard(): void {
    this.buffer = "";
    this.frozen = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /** Finalize: return the full accumulated content. */
  finish(): string {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    return this.buffer;
  }

  private scheduleUpdate(): void {
    if (this.timer) return;
    const elapsed = Date.now() - this.lastSentAt;
    const delay = Math.max(0, this.config.intervalMs - elapsed);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, delay);
  }

  private async flush(): Promise<void> {
    if (this.frozen) return;
    const content = this.buffer.length > this.config.maxChars
      ? this.buffer.slice(0, this.config.maxChars) + "\n\n... (streaming)"
      : this.buffer;

    if (content === this.lastSent) return;
    if (content.length - this.lastSent.length < this.config.minDeltaChars) return;

    try {
      if (this.messageId && this.sender.updateMarkdown) {
        await this.sender.updateMarkdown(this.messageId, content);
      } else {
        const id = await this.sender.sendMarkdown(this.chatID, content);
        if (id) this.messageId = id;
      }
      this.lastSent = content;
      this.lastSentAt = Date.now();
    } catch {
      // Ignore update failures (message may have been deleted)
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/streaming.ts
git commit -m "feat: add core/streaming.ts (throttled stream preview with freeze/discard lifecycle)"
```

---

### Task 8: Create core/permission.ts (interactive permission flow)

**Files:**
- Create: `src/core/permission.ts`

- [ ] **Step 1: Create `src/core/permission.ts`**

```typescript
// src/core/permission.ts
import type { PlatformSender, InlineButtonSender, ReplyContext } from "./interfaces.js";
import type { AskQuestion } from "../agent/types.js";
import { CardBuilder, renderCardAsText, collectCardButtons } from "./cards.js";
import { supportsInlineButtons } from "../platform/types.js";
import { log } from "./logger.js";

const ALLOW_KEYWORDS = new Set(["y", "yes", "allow", "ok", "是", "允许", "同意", "好"]);
const DENY_KEYWORDS = new Set(["n", "no", "deny", "reject", "否", "拒绝", "不"]);
const APPROVE_ALL_KEYWORDS = new Set(["yesall", "yes all", "allow all", "全部允许", "always"]);

export function isAllowResponse(text: string): boolean {
  return ALLOW_KEYWORDS.has(text.trim().toLowerCase());
}

export function isDenyResponse(text: string): boolean {
  return DENY_KEYWORDS.has(text.trim().toLowerCase());
}

export function isApproveAllResponse(text: string): boolean {
  return APPROVE_ALL_KEYWORDS.has(text.trim().toLowerCase());
}

/** Build a permission prompt card. */
export function buildPermissionCard(tool: string, input: string, questions?: AskQuestion[]) {
  const builder = new CardBuilder()
    .title("Permission Request", "orange")
    .markdown(`**Tool:** \`${tool}\`\n\n**Input:**\n\`\`\`\n${input.slice(0, 500)}\n\`\`\``);

  if (questions && questions.length > 0) {
    for (const q of questions) {
      builder.markdown(`\n**${q.question}**`);
      if (q.options) {
        for (let i = 0; i < q.options.length; i++) {
          builder.listItem(`${i + 1}. ${q.options[i]}`);
        }
      }
    }
    builder.divider().note("Reply with an option number or type your answer.");
  } else {
    builder.divider().buttons([
      { text: "Allow", value: "perm:allow", type: "primary" },
      { text: "Deny", value: "perm:deny", type: "danger" },
      { text: "Allow All", value: "perm:allow_all" },
    ]).note("Allow this tool to run? 'Allow All' auto-approves future requests this session.");
  }

  return builder.build();
}

/** Send a permission prompt to the user via the best available method. */
export async function sendPermissionPrompt(
  sender: PlatformSender,
  replyCtx: ReplyContext,
  tool: string,
  input: string,
  questions?: AskQuestion[],
): Promise<void> {
  const card = buildPermissionCard(tool, input, questions);

  if (sender.sendInteractiveCard) {
    // Platform supports cards natively (e.g., Feishu)
    // Delegate to platform-specific card rendering via the card JSON
    const text = renderCardAsText(card);
    await sender.sendInteractiveCard(replyCtx.chatID, JSON.stringify(card));
  } else if (supportsInlineButtons(sender as any)) {
    // Platform supports inline buttons (e.g., Telegram, Discord)
    const buttons = collectCardButtons(card);
    const text = renderCardAsText(card);
    await (sender as any as InlineButtonSender).sendWithButtons(
      replyCtx.chatID, text,
      [buttons.map((b) => ({ text: b.text, value: b.value }))],
    );
  } else {
    // Fallback: plain text
    const text = renderCardAsText(card);
    await sender.sendText(replyCtx.chatID, text + "\n\nReply 'y' to allow, 'n' to deny, 'yes all' to allow all.");
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/permission.ts
git commit -m "feat: add core/permission.ts (interactive permission flow with multi-language + card rendering)"
```

---

## Chunk 2: Engine + Command System

### Task 9: Create core/command/ (command registry + built-in handlers)

**Files:**
- Create: `src/core/command/registry.ts`
- Create: `src/core/command/index.ts`

- [ ] **Step 1: Create `src/core/command/registry.ts`**

```typescript
// src/core/command/registry.ts
import { log } from "../logger.js";

export interface CommandContext {
  args: string;           // Everything after the command name
  userID: string;
  chatID: string;
  chatType: "p2p" | "group";
  platform: string;
  // Engine provides these via closure — commands don't import Engine
  reply: (text: string) => Promise<void>;
  replyCard: (cardJson: string) => Promise<void>;
}

export type CommandHandler = (ctx: CommandContext) => Promise<void>;

export interface CommandDef {
  name: string;
  description: string;
  handler: CommandHandler;
  aliases?: string[];
  adminOnly?: boolean;
}

/** Custom command from config or agent directory. */
export interface CustomCommand {
  name: string;
  description: string;
  prompt: string;         // Template with {{1}}, {{2*}}, {{args}} placeholders
  exec?: string;          // Shell command instead of prompt
}

/** Registry for slash commands. */
export class CommandRegistry {
  private commands = new Map<string, CommandDef>();
  private customs = new Map<string, CustomCommand>();

  register(cmd: CommandDef): void {
    this.commands.set(cmd.name, cmd);
    if (cmd.aliases) {
      for (const alias of cmd.aliases) {
        this.commands.set(alias, cmd);
      }
    }
  }

  registerCustom(cmd: CustomCommand): void {
    this.customs.set(cmd.name, cmd);
  }

  /** Resolve a command name (prefix match with disambiguation). */
  resolve(name: string): CommandDef | CustomCommand | undefined {
    // Exact match first
    const exact = this.commands.get(name) ?? this.customs.get(name);
    if (exact) return exact;

    // Prefix match
    const matches = [...this.commands.values(), ...this.customs.values()]
      .filter((c) => c.name.startsWith(name));
    if (matches.length === 1) return matches[0];
    return undefined;
  }

  listAll(): (CommandDef | CustomCommand)[] {
    const seen = new Set<string>();
    const result: (CommandDef | CustomCommand)[] = [];
    for (const cmd of this.commands.values()) {
      if (!seen.has(cmd.name)) {
        seen.add(cmd.name);
        result.push(cmd);
      }
    }
    for (const cmd of this.customs.values()) {
      if (!seen.has(cmd.name)) {
        seen.add(cmd.name);
        result.push(cmd);
      }
    }
    return result;
  }
}

/** Expand a custom command template. */
export function expandPrompt(template: string, args: string): string {
  const parts = args.split(/\s+/).filter(Boolean);
  let result = template;
  // {{1}}, {{2}}, etc. — individual positional args
  result = result.replace(/\{\{(\d+)\}\}/g, (_, n) => parts[Number(n) - 1] ?? "");
  // {{2*}} — all args from position 2 onwards
  result = result.replace(/\{\{(\d+)\*\}\}/g, (_, n) => parts.slice(Number(n) - 1).join(" "));
  // {{args}} — all args
  result = result.replace(/\{\{args\}\}/g, args);
  return result.trim();
}
```

- [ ] **Step 2: Create `src/core/command/index.ts`**

```typescript
export { CommandRegistry, expandPrompt } from "./registry.js";
export type { CommandDef, CommandHandler, CommandContext, CustomCommand } from "./registry.js";
```

- [ ] **Step 3: Commit**

```bash
git add src/core/command/
git commit -m "feat: add core/command/ (command registry with prefix matching + template expansion)"
```

---

### Task 10: Create core/engine.ts (central orchestrator — skeleton)

**Files:**
- Create: `src/core/engine.ts`

This is the largest new file. We create it as a skeleton first, then fill in the message handling logic.

- [ ] **Step 1: Create `src/core/engine.ts` skeleton**

```typescript
// src/core/engine.ts
import type {
  Agent, AgentSession, AgentEvent, MessageEvent,
  PlatformSender, PlatformAdapter, ReplyContext,
} from "./interfaces.js";
import type { InteractiveState, PendingPermission } from "./session/state.js";
import { MAX_QUEUED_MESSAGES } from "./session/state.js";
import { SessionManager } from "./session/manager.js";
import { SessionQueue } from "./session/queue.js";
import { StreamPreview } from "./streaming.js";
import { MessageDedup } from "./dedup.js";
import { CommandRegistry } from "./command/registry.js";
import {
  isAllowResponse, isDenyResponse, isApproveAllResponse,
  sendPermissionPrompt,
} from "./permission.js";
import { log } from "./logger.js";

export interface EngineConfig {
  project: string;
  dataDir: string;
  sessionTtlMs: number;
  streamPreview?: { intervalMs?: number; minDeltaChars?: number; maxChars?: number };
}

export class Engine {
  readonly project: string;
  readonly agent: Agent;
  readonly platforms: PlatformAdapter[] = [];

  private sessions: SessionManager;
  private queue: SessionQueue;
  private commands: CommandRegistry;
  private dedup: MessageDedup;
  private states = new Map<string, InteractiveState>();

  constructor(
    agent: Agent,
    config: EngineConfig,
  ) {
    this.project = config.project;
    this.agent = agent;
    this.sessions = new SessionManager(config.sessionTtlMs);
    this.queue = new SessionQueue();
    this.commands = new CommandRegistry();
    this.dedup = new MessageDedup();
  }

  /** Register a platform adapter. */
  addPlatform(platform: PlatformAdapter): void {
    this.platforms.push(platform);
  }

  /** Start all platforms with this engine as the message handler. */
  async start(): Promise<void> {
    for (const p of this.platforms) {
      const handler = (event: MessageEvent, sender: PlatformSender) =>
        this.handleMessage(event, sender, p);
      await p.start(handler);
      log("info", `Platform started: ${p.name}`);
    }
  }

  /** Stop all platforms and the agent. */
  async stop(): Promise<void> {
    for (const p of this.platforms) {
      await p.stop().catch(() => {});
    }
    await this.agent.stop();
    this.dedup.dispose();
    log("info", "Engine stopped");
  }

  /** Main message handler — called by platform adapters. */
  async handleMessage(
    event: MessageEvent,
    sender: PlatformSender,
    platform: PlatformAdapter,
  ): Promise<void> {
    // 1. Dedup
    if (this.dedup.isDuplicate(event.messageID)) return;

    // 2. Build reply context
    const replyCtx: ReplyContext = {
      platform: event.platform,
      chatID: event.chatID,
      chatType: event.chatType,
      userID: event.userID,
      messageID: event.messageID,
    };

    // 3. Check for pending permission response
    const sessionKey = `${this.project}:${event.userID}`;
    const state = this.states.get(sessionKey);
    if (state?.pending && !state.pending.resolved) {
      this.resolvePermission(state, event.text);
      return;
    }

    // 4. Command dispatch
    if (event.text.startsWith("/")) {
      const [cmdName, ...rest] = event.text.slice(1).split(/\s+/);
      const cmd = this.commands.resolve(cmdName);
      if (cmd) {
        const ctx = {
          args: rest.join(" "),
          userID: event.userID,
          chatID: event.chatID,
          chatType: event.chatType,
          platform: event.platform,
          reply: (text: string) => sender.sendText(event.chatID, text),
          replyCard: (json: string) => sender.sendInteractiveCard?.(event.chatID, json) ?? sender.sendText(event.chatID, json),
        };
        if ("handler" in cmd) {
          await cmd.handler(ctx);
        }
        return;
      }
    }

    // 5. Queue to per-session serial processor
    await this.queue.enqueue(sessionKey, async () => {
      await this.processMessage(sessionKey, event, sender, replyCtx);
    });
  }

  private async processMessage(
    sessionKey: string,
    event: MessageEvent,
    sender: PlatformSender,
    replyCtx: ReplyContext,
  ): Promise<void> {
    // Get or create interactive state
    let state = this.states.get(sessionKey);
    if (!state) {
      const agentSession = await this.agent.startSession({
        workDir: process.cwd(), // TODO: workspace binding
        continueSession: true,
      });
      state = {
        sessionKey,
        agentSession,
        replyCtx,
        pendingMessages: [],
        approveAll: false,
        quiet: false,
        lastActivity: Date.now(),
      };
      this.states.set(sessionKey, state);
    }
    state.replyCtx = replyCtx;
    state.lastActivity = Date.now();

    // Send message to agent
    await state.agentSession.send(event.text);

    // Process events
    const preview = new StreamPreview(event.chatID, sender);
    let textBuffer = "";

    for await (const ev of state.agentSession.events()) {
      switch (ev.type) {
        case "text":
          textBuffer += ev.content;
          preview.append(ev.content);
          break;

        case "thinking":
          if (!state.quiet) {
            // Optionally show thinking indicator
          }
          break;

        case "tool_use":
          // Flush text before showing tool
          if (textBuffer) {
            preview.finish();
            textBuffer = "";
          }
          if (!state.quiet) {
            await sender.sendText(event.chatID, `🔧 Using: ${ev.tool}`);
          }
          break;

        case "permission_request":
          preview.freeze();
          if (state.approveAll && !ev.questions) {
            state.agentSession.respondPermission(true);
          } else {
            // Create pending permission
            state.pending = {
              requestId: ev.id,
              tool: ev.tool,
              input: ev.input,
              questions: ev.questions,
              resolved: false,
              resolve: (allowed, msg) => {
                state!.pending!.resolved = true;
                state!.agentSession.respondPermission(allowed, msg);
                preview.unfreeze();
              },
            };
            await sendPermissionPrompt(sender, replyCtx, ev.tool, ev.input, ev.questions);
          }
          break;

        case "result":
          const finalContent = preview.finish() || ev.content;
          if (finalContent && !state.quiet) {
            await sender.sendMarkdown(event.chatID, finalContent);
          }
          // Drain queued messages
          while (state.pendingMessages.length > 0) {
            const queued = state.pendingMessages.shift()!;
            await state.agentSession.send(queued.text);
          }
          break;

        case "error":
          preview.discard();
          await sender.sendText(event.chatID, `❌ Error: ${ev.message}`);
          break;
      }
    }
  }

  private resolvePermission(state: InteractiveState, text: string): void {
    if (!state.pending || state.pending.resolved) return;

    if (isApproveAllResponse(text)) {
      state.approveAll = true;
      state.pending.resolve(true);
    } else if (isAllowResponse(text) || text === "perm:allow") {
      state.pending.resolve(true);
    } else if (isDenyResponse(text) || text === "perm:deny") {
      state.pending.resolve(false, "User denied permission");
    } else if (text === "perm:allow_all") {
      state.approveAll = true;
      state.pending.resolve(true);
    } else if (state.pending.questions) {
      // Free text answer for AskUserQuestion
      state.pending.resolve(true, text);
    }
  }
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/core/engine.ts
git commit -m "feat: add core/engine.ts skeleton (message routing, permission flow, stream preview)"
```

---

## Chunk 3: Agent Backends

### Task 11: Create agent/claude/ (persistent process backend)

**Files:**
- Create: `src/agent/claude/agent.ts`
- Create: `src/agent/claude/session.ts`

- [ ] **Step 1: Create `src/agent/claude/session.ts`**

Port from `src/claude/client.ts`, adapting to the `AgentSession` interface. Key changes:
- Use `--input-format stream-json --output-format stream-json --permission-prompt-tool stdio`
- Persistent process (no respawn per message)
- Write user messages to stdin as `{ type: "user", content: [{ type: "text", text }] }`
- Parse stdout events and map to `AgentEvent`
- Handle `control_request` events for permissions
- Write `control_response` for permission answers
- Use `createLineIterator` from `core/utils.ts`

The session.ts file will be ~300 lines (porting the stream-json protocol from the reference Go implementation).

- [ ] **Step 2: Create `src/agent/claude/agent.ts`**

Port from `src/claude/client.ts` + `src/claude/sessions.ts`. Implements `Agent` + optional interfaces (`ModelSwitcher`, `ModeSwitcher`, `MemoryFileProvider`, `CommandProvider`, `SkillProvider`, `ContextCompressor`).

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/agent/claude/
git commit -m "feat: add agent/claude/ (persistent process with bidirectional stream-json + permission stdio)"
```

---

### Task 12: Create agent/codex/ (per-turn subprocess)

**Files:**
- Create: `src/agent/codex/agent.ts`
- Create: `src/agent/codex/session.ts`

- [ ] **Step 1: Port from `src/backend/codex.ts`**

Adapt to Agent/AgentSession interface. Key: each `send()` spawns `codex exec [resume <threadId>] --json --cd <dir> <prompt>`. Parse stdout JSON for thread.started, item.started, item.completed, turn.completed events. `respondPermission()` is a no-op.

- [ ] **Step 2: Commit**

```bash
git add src/agent/codex/
git commit -m "feat: add agent/codex/ (per-turn subprocess with thread ID resume)"
```

---

### Task 13: Create agent/gemini/ (per-turn subprocess)

**Files:**
- Create: `src/agent/gemini/agent.ts`
- Create: `src/agent/gemini/session.ts`

- [ ] **Step 1: Port from `src/backend/gemini.ts`**

Adapt to Agent/AgentSession interface. Key: spawns `gemini --output-format stream-json [--resume <chatId>] -p <prompt>`. Parse init/message/tool_use/tool_result/result events.

- [ ] **Step 2: Commit**

```bash
git add src/agent/gemini/
git commit -m "feat: add agent/gemini/ (per-turn subprocess with stream-json)"
```

---

### Task 14: Create agent/cursor/ (per-turn subprocess)

**Files:**
- Create: `src/agent/cursor/agent.ts`
- Create: `src/agent/cursor/session.ts`

- [ ] **Step 1: Port from `src/backend/cursor.ts`**

Adapt to Agent/AgentSession interface. Key: spawns `agent --print --output-format stream-json --trust [--resume <chatId>] -- <prompt>`. Handle thinking delta accumulation.

- [ ] **Step 2: Commit**

```bash
git add src/agent/cursor/
git commit -m "feat: add agent/cursor/ (per-turn subprocess with thinking deltas)"
```

---

### Task 15: Create agent/opencode/ (per-turn subprocess)

**Files:**
- Create: `src/agent/opencode/agent.ts`
- Create: `src/agent/opencode/session.ts`

- [ ] **Step 1: Port from `src/opencode/client.ts`**

Adapt to Agent/AgentSession interface. Key: spawns `opencode run --format json`.

- [ ] **Step 2: Commit**

```bash
git add src/agent/opencode/
git commit -m "feat: add agent/opencode/ (per-turn subprocess)"
```

---

## Chunk 4: Platform Adapters (migrate existing)

### Task 16: Update platform adapters for new Engine

**Files:**
- Modify: `src/platform/feishu/adapter.ts`
- Modify: `src/platform/telegram/adapter.ts`
- Modify: `src/platform/discord/adapter.ts`
- Modify: `src/platform/dingtalk/adapter.ts`
- Modify: `src/platform/registry.ts`

- [ ] **Step 1: Update platform/registry.ts to support factory pattern**

Add `registerPlatform`/`createPlatform` alongside existing `registerAdapter`/`allAdapters` for backward compatibility during migration.

- [ ] **Step 2: Ensure each adapter's `MessageEvent` includes platform name**

Verify all 4 adapters set `event.platform` correctly (they already do).

- [ ] **Step 3: Verify Feishu card rendering works with new core/cards.ts**

Update `src/platform/feishu/cards.ts` to import `Card` from `../../core/cards.js` instead of `../types.js`.

- [ ] **Step 4: Commit**

```bash
git add src/platform/
git commit -m "refactor: update platform adapters for engine integration"
```

---

## Chunk 5: New Capabilities

### Task 17: Create core/cron.ts (proper cron scheduler)

**Files:**
- Create: `src/core/cron.ts`

- [ ] **Step 1: Port cron parsing from `src/scheduler/cron-parser.ts` and job management from `src/cron/manager.ts`**

Replace the setInterval approximation with proper field-level matching using the existing `parseCron`/`matchesCron` from scheduler/. Merge both into one file. Add `cronToHuman()` for display.

- [ ] **Step 2: Commit**

```bash
git add src/core/cron.ts
git commit -m "feat: add core/cron.ts (proper field-level cron matching, replaces setInterval approximation)"
```

---

### Task 18: Migrate remaining modules to core/

**Files:**
- Create: `src/core/relay.ts` (from `src/relay/manager.ts`)
- Create: `src/core/ratelimit.ts` (from `src/ratelimit/limiter.ts`)
- Create: `src/core/context.ts` (from `src/context/manager.ts`)
- Create: `src/core/memory.ts` (from `src/memory/extractor.ts`)
- Create: `src/core/stt.ts` (from `src/voice/stt.ts`)
- Create: `src/core/tts.ts` (from `src/voice/tts.ts`)
- Create: `src/core/error.ts` (from `src/error/classifier.ts`)

- [ ] **Step 1: Copy each file into core/, updating imports to use core/logger and core/utils**

Minimal changes: just fix import paths and replace inline `log()` functions with the shared one.

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/core/relay.ts src/core/ratelimit.ts src/core/context.ts src/core/memory.ts src/core/stt.ts src/core/tts.ts src/core/error.ts
git commit -m "refactor: migrate relay, ratelimit, context, memory, voice, error to core/"
```

---

### Task 19: Create core/workspace/binding.ts (channel-to-workspace mapping)

**Files:**
- Create: `src/core/workspace/binding.ts`
- Move: `src/workspace/workspace.ts` → `src/core/workspace/workspace.ts`

- [ ] **Step 1: Move workspace.ts to core/workspace/**

- [ ] **Step 2: Create binding.ts**

```typescript
// src/core/workspace/binding.ts
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { log } from "../logger.js";
import { atomicWriteFile } from "../utils.js";

export interface WorkspaceBinding {
  channelKey: string;
  workspace: string;
  boundAt: number;
}

export class WorkspaceBindingManager {
  private bindings = new Map<string, WorkspaceBinding>();
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  bind(channelKey: string, workspace: string): void {
    this.bindings.set(channelKey, { channelKey, workspace, boundAt: Date.now() });
    this.save();
  }

  unbind(channelKey: string): void {
    this.bindings.delete(channelKey);
    this.save();
  }

  lookup(channelKey: string): string | undefined {
    return this.bindings.get(channelKey)?.workspace;
  }

  list(): WorkspaceBinding[] {
    return [...this.bindings.values()];
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const data = JSON.parse(readFileSync(this.filePath, "utf-8"));
      for (const b of data) {
        this.bindings.set(b.channelKey, b);
      }
    } catch { /* ignore corrupt file */ }
  }

  private save(): void {
    atomicWriteFile(this.filePath, JSON.stringify([...this.bindings.values()], null, 2));
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/core/workspace/
git commit -m "feat: add core/workspace/binding.ts (channel-to-workspace mapping) + move workspace.ts"
```

---

## Chunk 6: Entry Point Rewrite + Cleanup

### Task 20: Rewrite index.ts to use Engine

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Rewrite index.ts**

Replace the current 351-line bootstrap with a simpler Engine-based flow:
1. Load config
2. Create agent via registry
3. Create engine with agent + config
4. Register platform adapters on engine
5. Start engine
6. Graceful shutdown

- [ ] **Step 2: Verify the full app compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "refactor: rewrite index.ts to use Engine orchestrator"
```

---

### Task 21: Delete old files

**Files to delete:**
- `src/backend/` (entire directory)
- `src/claude/` (entire directory)
- `src/opencode/` (entire directory)
- `src/router/` (entire directory)
- `src/runner/` (entire directory)
- `src/tools/` (entire directory)
- `src/scheduler/` (entire directory)
- `src/session/` (entire directory — replaced by core/session/)
- `src/context/` (entire directory — replaced by core/context.ts)
- `src/memory/` (entire directory — replaced by core/memory.ts)
- `src/error/` (entire directory — replaced by core/error.ts)
- `src/cron/` (entire directory — replaced by core/cron.ts)
- `src/relay/` (entire directory — replaced by core/relay.ts)
- `src/ratelimit/` (entire directory — replaced by core/ratelimit.ts)
- `src/voice/` (entire directory — replaced by core/stt.ts + core/tts.ts)
- `src/workspace/` (entire directory — replaced by core/workspace/)

- [ ] **Step 1: Delete old directories**

```bash
rm -rf src/backend src/claude src/opencode src/router src/runner src/tools src/scheduler
rm -rf src/session src/context src/memory src/error src/cron src/relay src/ratelimit src/voice src/workspace
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit`
Fix any remaining import errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "cleanup: delete old modules replaced by core/ + agent/ architecture"
```

---
