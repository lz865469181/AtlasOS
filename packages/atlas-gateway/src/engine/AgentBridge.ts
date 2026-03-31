import type {
  AgentBackend,
  AgentMessage,
  AgentMessageHandler,
  AgentRegistry,
  AgentFactoryOptions,
} from 'atlas-agent';
import type { CardEngineImpl } from './CardEngine.js';
import type { SessionInfo } from './SessionManager.js';
import type { ChannelEvent } from '../channel/channelEvent.js';
import { SessionQueue, sessionKey } from './SessionQueue.js';

// ── Types ──────────────────────────────────────────────────────────────────

interface ManagedAgentSession {
  agent: AgentBackend;
  agentSessionId: string;
  handler: AgentMessageHandler;
}

export interface AgentBridgeDeps {
  registry: AgentRegistry;
  cardEngine: CardEngineImpl;
  queue: SessionQueue;
  agentOpts: AgentFactoryOptions;
}

// ── Implementation ─────────────────────────────────────────────────────────

export class AgentBridge {
  private readonly registry: AgentRegistry;
  private readonly cardEngine: CardEngineImpl;
  private readonly queue: SessionQueue;
  private readonly agentOpts: AgentFactoryOptions;

  /** Gateway sessionId -> ManagedAgentSession */
  private sessions = new Map<string, ManagedAgentSession>();

  constructor(deps: AgentBridgeDeps) {
    this.registry = deps.registry;
    this.cardEngine = deps.cardEngine;
    this.queue = deps.queue;
    this.agentOpts = deps.agentOpts;
  }

  /**
   * Matches the OnPromptCallback signature.
   * Creates agent on first call, reuses on subsequent calls.
   * Uses SessionQueue for per-chat serial execution.
   */
  async handlePrompt(session: SessionInfo, event: ChannelEvent): Promise<void> {
    const key = sessionKey(event);

    await this.queue.enqueue(key, async () => {
      try {
        // Ensure agent exists for this gateway session
        let managed = this.sessions.get(session.sessionId);

        if (!managed) {
          // First call: create agent, start session, bind onMessage ONCE
          const agent = this.registry.create(session.agentId, this.agentOpts);

          const result = await agent.startSession();

          const handler: AgentMessageHandler = (msg: AgentMessage) => {
            this.cardEngine.handleMessage(session.sessionId, session.chatId, msg);
          };
          agent.onMessage(handler);

          managed = {
            agent,
            agentSessionId: result.sessionId,
            handler,
          };
          this.sessions.set(session.sessionId, managed);
        }

        // Only send text content
        if (event.content.type !== 'text') return;

        await managed.agent.sendPrompt(managed.agentSessionId, event.content.text);
      } catch (err) {
        const entry = {
          time: new Date().toISOString(),
          level: 'error',
          msg: 'AgentBridge.handlePrompt failed',
          sessionId: session.sessionId,
          chatId: session.chatId,
          agentId: session.agentId,
          error: String(err),
        };
        console.error(JSON.stringify(entry));
        throw err;
      }
    });
  }

  /**
   * Forward permission response to the agent for a given gateway session.
   * No-ops if session is unknown or agent lacks respondToPermission.
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
   * Dispose all managed agents: unbind handlers and call dispose.
   */
  async dispose(): Promise<void> {
    const entries = Array.from(this.sessions.values());
    this.sessions.clear();

    await Promise.all(
      entries.map(async (managed) => {
        if (managed.agent.offMessage) {
          managed.agent.offMessage(managed.handler);
        }
        await managed.agent.dispose();
      }),
    );
  }
}
