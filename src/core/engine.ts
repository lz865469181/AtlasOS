import { join } from "node:path";
import { projectRoot } from "../config.js";
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
import { ParkedSessionStore } from "./session/parked.js";
import type { CronManager } from "./cron.js";
import { log } from "./logger.js";
import { WorkspaceBindingStore } from "./workspace/bindings.js";
import { WorkspacePool } from "./workspace/pool.js";
import { normalizeWorkspacePath } from "./session/normalize.js";

export interface EngineConfig {
  project: string;
  dataDir: string;
  sessionTtlMs: number;
  persistPath?: string;
  streamPreview?: { intervalMs?: number; minDeltaChars?: number; maxChars?: number };

  /** Multi-workspace mode: route messages to per-workspace agents. */
  mode?: "single" | "multi-workspace";
  /** Parent directory for workspaces (required when mode = "multi-workspace"). */
  baseDir?: string;
  /** Factory to create an Agent for a given workDir (required when mode = "multi-workspace"). */
  createAgent?: (workDir: string) => Agent;
}

export class Engine {
  readonly project: string;
  readonly agent: Agent;
  readonly platforms: PlatformAdapter[] = [];
  readonly commands: CommandRegistry;
  readonly parkedSessions: ParkedSessionStore;

  private sessions: SessionManager;
  private queue: SessionQueue;
  private dedup: MessageDedup;
  private states = new Map<string, InteractiveState>();
  private config: EngineConfig;
  private _startedAt: number = Date.now();
  private _cronManager: CronManager | null = null;

  // ─── Multi-workspace fields ─────────────────────────────────────────
  private workspaceBindings?: WorkspaceBindingStore;
  private workspacePool?: WorkspacePool;
  private multiWorkspaceMode = false;
  private _baseDir?: string;

  constructor(agent: Agent, config: EngineConfig) {
    this.project = config.project;
    this.agent = agent;
    this.config = config;
    this._startedAt = Date.now();
    this.sessions = new SessionManager(config.sessionTtlMs, config.persistPath);
    this.queue = new SessionQueue();
    this.commands = new CommandRegistry();
    this.dedup = new MessageDedup();

    if (config.persistPath) {
      this.sessions.loadFromDisk();
    }

    const parkedPath = config.persistPath
      ? config.persistPath.replace(/sessions\.json$/, "parked.json")
      : undefined;
    this.parkedSessions = new ParkedSessionStore(parkedPath);
    this.parkedSessions.loadFromDisk();

    // ─── Multi-workspace init ───────────────────────────────────────
    if (config.mode === "multi-workspace" && config.baseDir && config.createAgent) {
      this.multiWorkspaceMode = true;
      this._baseDir = normalizeWorkspacePath(config.baseDir);
      this.workspaceBindings = new WorkspaceBindingStore(
        join(config.dataDir, "workspace_bindings.json"),
      );
      this.workspacePool = new WorkspacePool({
        createAgent: config.createAgent,
        idleTimeoutMs: 15 * 60 * 1000,
      });
      log("info", "Multi-workspace mode enabled", { baseDir: this._baseDir });
    }
  }

  // ─── Public Getters (Management API) ──────────────────────────────

  get sessionMgr(): SessionManager {
    return this.sessions;
  }

  get agentName(): string {
    return this.agent.name;
  }

  get platformNames(): string[] {
    return this.platforms.map((p) => p.name);
  }

  get startedAt(): number {
    return this._startedAt;
  }

  get cronManager(): CronManager | null {
    return this._cronManager;
  }

  set cronManager(mgr: CronManager | null) {
    this._cronManager = mgr;
  }

  /** Get workspace binding store (for /workspace commands). */
  get bindings(): WorkspaceBindingStore | undefined { return this.workspaceBindings; }

  /** Get workspace pool (for /workspace commands). */
  get pool(): WorkspacePool | undefined { return this.workspacePool; }

  /** Whether multi-workspace mode is enabled. */
  get isMultiWorkspace(): boolean { return this.multiWorkspaceMode; }

  /** Base directory for workspaces. */
  get workspaceBaseDir(): string | undefined { return this._baseDir; }

  addPlatform(platform: PlatformAdapter): void {
    this.platforms.push(platform);
  }

  async start(): Promise<void> {
    for (const p of this.platforms) {
      const handler = (event: MessageEvent, sender: PlatformSender) =>
        this.handleMessage(event, sender, p);
      await p.start(handler);
      log("info", `Platform started: ${p.name}`);
    }
  }

  async stop(): Promise<void> {
    for (const p of this.platforms) {
      await p.stop().catch(() => {});
    }
    await this.agent.stop();
    if (this.workspacePool) await this.workspacePool.stopAll();
    if (this.workspaceBindings) this.workspaceBindings.flush();
    this.dedup.dispose();
    this.sessions.dispose();
    this.queue.dispose();
    this.parkedSessions.saveToDisk();
    log("info", "Engine stopped");
  }

  /**
   * Resolve the correct Agent for the given message event.
   * In single mode, returns the default agent.
   * In multi-workspace mode, looks up workspace binding and returns the pool agent.
   * Throws with code "NO_WORKSPACE_BOUND" if no binding found.
   */
  resolveAgentForMessage(event: MessageEvent): { agent: Agent; workspace?: string } {
    if (!this.multiWorkspaceMode) return { agent: this.agent };

    const channelKey = `${event.platform}:${event.chatID}`;
    const binding = this.workspaceBindings!.get(channelKey);
    if (!binding) {
      const err = new Error("No workspace bound to this channel. Use `/workspace bind <name>` or `/workspace init <git-url>` to set up.");
      (err as any).code = "NO_WORKSPACE_BOUND";
      throw err;
    }

    const { agent, workspace } = this.workspacePool!.getOrCreate(binding.workspace);
    return { agent, workspace };
  }

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

    // 2b. Multi-workspace: resolve agent early, reply with guidance if unbound
    let resolvedAgent: Agent = this.agent;
    let resolvedWorkspace: string | undefined;
    if (this.multiWorkspaceMode) {
      try {
        const resolved = this.resolveAgentForMessage(event);
        resolvedAgent = resolved.agent;
        resolvedWorkspace = resolved.workspace;
      } catch (err: any) {
        if (err.code === "NO_WORKSPACE_BOUND") {
          // Allow slash commands through even without a bound workspace
          if (!event.text.startsWith("/")) {
            await sender.sendText(event.chatID, err.message);
            return;
          }
        } else {
          throw err;
        }
      }
    }

    // 3. Check for pending permission response
    const baseSessionKey = `${this.project}:${event.userID}`;
    const sessionKey = this.multiWorkspaceMode && resolvedWorkspace
      ? `${resolvedWorkspace}:${baseSessionKey}`
      : baseSessionKey;

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
          replyCard: (json: string) =>
            sender.sendInteractiveCard?.(event.chatID, json) ?? sender.sendText(event.chatID, json),
        };
        if ("handler" in cmd) {
          await cmd.handler(ctx);
        }
        return;
      }
    }

    // 5. Queue to per-session serial processor
    await this.queue.enqueue(sessionKey, async () => {
      await this.processMessage(sessionKey, event, sender, replyCtx, resolvedAgent);
    });
  }

  private async processMessage(
    sessionKey: string,
    event: MessageEvent,
    sender: PlatformSender,
    replyCtx: ReplyContext,
    agentOverride?: Agent,
  ): Promise<void> {
    const activeAgent = agentOverride ?? this.agent;

    // Get or create interactive state
    let state = this.states.get(sessionKey);
    if (!state) {
      const meta = this.sessions.get(sessionKey);
      const savedId = meta?.cliSessionId;
      let agentSession: AgentSession;
      try {
        agentSession = await activeAgent.startSession({
          workDir: projectRoot,
          ...(savedId ? { sessionId: savedId } : { continueSession: true }),
        });
        console.log("[session] spawn", { sessionKey, sessionId: savedId || "new" });
      } catch (err: any) {
        if (savedId) {
          console.error(`[session] resume-failed sessionKey=${sessionKey} sessionId=${savedId} error=${err.message}`);
          this.sessions.clearAgentSessionId(sessionKey);
          agentSession = await activeAgent.startSession({
            workDir: projectRoot,
          });
          console.log(`[session] fallback-fresh sessionKey=${sessionKey}`);
          await sender.sendText(event.chatID, "Session context was too large to resume — starting fresh.");
        } else {
          throw err;
        }
      }
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
    const preview = new StreamPreview(event.chatID, sender, this.config.streamPreview);
    let textBuffer = "";

    for await (const ev of state.agentSession.events()) {
      switch (ev.type) {
        case "text":
          textBuffer += ev.content;
          preview.append(ev.content);
          break;

        case "thinking":
          // Optionally show thinking indicator
          break;

        case "tool_use":
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

        case "result": {
          if (ev.sessionId) {
            const meta = this.sessions.get(sessionKey);
            if (meta) {
              meta.cliSessionId = ev.sessionId;
            }
          }
          if (ev.usage?.inputTokens) {
            state.inputTokens = ev.usage.inputTokens;
          }
          let finalContent = preview.finish() || ev.content;
          if (finalContent && !state.quiet) {
            if (state.inputTokens && state.inputTokens > 0) {
              const ctxSize = activeAgent.contextWindowSize ?? 200_000;
              const pct = Math.round((state.inputTokens / ctxSize) * 100);
              finalContent += `\n[ctx: ${pct}%]`;
            }
            await sender.sendMarkdown(event.chatID, finalContent);
          }
          // Drain queued messages
          while (state.pendingMessages.length > 0) {
            const queued = state.pendingMessages.shift()!;
            await state.agentSession.send(queued.text);
          }
          break;
        }

        case "error":
          preview.discard();
          await sender.sendText(event.chatID, `❌ Error: ${ev.message}`);
          break;
      }
    }
  }

  async resumeSession(
    cliSessionId: string,
    replyCtx: ReplyContext,
  ): Promise<void> {
    const sessionKey = `${this.project}:${replyCtx.userID}`;

    // Close existing session if any
    const existing = this.states.get(sessionKey);
    if (existing) {
      console.log("[session] close", { sessionKey });
      await existing.agentSession.close().catch(() => {});
    }

    // Start new session with the parked session's CLI ID
    let agentSession: AgentSession;
    try {
      agentSession = await this.agent.startSession({
        workDir: projectRoot,
        sessionId: cliSessionId,
      });
      console.log("[session] spawn", { sessionKey, sessionId: cliSessionId });
    } catch (err: any) {
      console.error(`[session] resume-failed sessionKey=${sessionKey} sessionId=${cliSessionId} error=${err.message}`);
      this.sessions.clearAgentSessionId(sessionKey);
      agentSession = await this.agent.startSession({
        workDir: projectRoot,
      });
      console.log(`[session] fallback-fresh sessionKey=${sessionKey}`);
    }

    const state: InteractiveState = {
      sessionKey,
      agentSession,
      replyCtx,
      pendingMessages: [],
      approveAll: false,
      quiet: false,
      lastActivity: Date.now(),
    };
    this.states.set(sessionKey, state);
    log("info", "Resumed parked session", { sessionKey, cliSessionId });
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
      state.pending.resolve(true, text);
    }
  }
}
