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
  readonly commands: CommandRegistry;

  private sessions: SessionManager;
  private queue: SessionQueue;
  private dedup: MessageDedup;
  private states = new Map<string, InteractiveState>();
  private config: EngineConfig;

  constructor(agent: Agent, config: EngineConfig) {
    this.project = config.project;
    this.agent = agent;
    this.config = config;
    this.sessions = new SessionManager(config.sessionTtlMs);
    this.queue = new SessionQueue();
    this.commands = new CommandRegistry();
    this.dedup = new MessageDedup();
  }

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
    this.dedup.dispose();
    this.sessions.dispose();
    this.queue.dispose();
    log("info", "Engine stopped");
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
        workDir: process.cwd(),
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
        }

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
      state.pending.resolve(true, text);
    }
  }
}
