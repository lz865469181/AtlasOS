import type {
  AgentBackend,
  AgentMessage,
  AgentMessageHandler,
  AgentRegistry,
  AgentFactoryOptions,
} from 'atlas-agent';
import type { CardEngineImpl } from './CardEngine.js';
import type { SessionInfo, SessionManagerImpl } from './SessionManager.js';
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
  sessionManager?: SessionManagerImpl;
}

// ── Implementation ─────────────────────────────────────────────────────────

export class AgentBridge {
  private readonly registry: AgentRegistry;
  private readonly cardEngine: CardEngineImpl;
  private readonly queue: SessionQueue;
  private readonly agentOpts: AgentFactoryOptions;
  private readonly sessionManager?: SessionManagerImpl;

  /** Gateway sessionId -> ManagedAgentSession */
  private sessions = new Map<string, ManagedAgentSession>();

  constructor(deps: AgentBridgeDeps) {
    this.registry = deps.registry;
    this.cardEngine = deps.cardEngine;
    this.queue = deps.queue;
    this.agentOpts = deps.agentOpts;
    this.sessionManager = deps.sessionManager;
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
            console.log(`[AgentBridge] msg type=${msg.type} session=${session.sessionId}`, msg.type === 'model-output' ? `delta=${!!(msg as any).textDelta} full=${!!(msg as any).fullText}` : msg.type === 'status' ? `status=${(msg as any).status}` : '');
            this.cardEngine.handleMessage(session.sessionId, session.chatId, msg);

            // Record assistant response in chat history when fullText is available
            if (msg.type === 'model-output' && (msg as any).fullText && this.sessionManager) {
              this.sessionManager.appendChat(session.chatId, session.threadKey, {
                role: 'assistant',
                text: (msg as any).fullText,
                ts: Date.now(),
              });
            }
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

        // Set the user's message as the reply target so new cards create a Feishu thread
        this.cardEngine.setReplyTarget(session.sessionId, event.messageId);

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
   * Cancel the running agent task for a given gateway session.
   * Calls agent.cancel() and cancels the CardEngine streaming state machine.
   * No-ops if session is unknown.
   */
  async cancelSession(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;

    await managed.agent.cancel(managed.agentSessionId);

    // Cancel the CardEngine streaming state machine for this session
    const sm = this.cardEngine.getStreamingState(sessionId);
    if (sm) {
      sm.cancel();
    }
  }

  /**
   * Destroy a managed agent session: cancel, unbind handler, dispose agent
   * if no other sessions share it, and remove from map.
   */
  async destroySession(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;

    // Cancel first
    await this.cancelSession(sessionId);

    // Remove from map
    this.sessions.delete(sessionId);

    // Clean up CardEngine state
    this.cardEngine.dispose(sessionId);

    // Check if any other session still uses the same agent instance
    const agentStillUsed = Array.from(this.sessions.values()).some(
      (s) => s.agent === managed.agent,
    );

    if (!agentStillUsed) {
      if (managed.agent.offMessage) {
        managed.agent.offMessage(managed.handler);
      }
      await managed.agent.dispose();
    }
  }

  /**
   * Dispose all managed agents: unbind handlers and call dispose.
   */
  async dispose(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    for (const sessionId of sessionIds) {
      await this.destroySession(sessionId);
    }
  }
}
