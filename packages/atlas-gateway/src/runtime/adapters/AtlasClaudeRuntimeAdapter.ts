import type {
  AgentBackend,
  AgentFactoryOptions,
  AgentId,
  AgentMessage,
  AgentMessageHandler,
  AgentRegistry,
} from 'codelink-agent';
import type { CardEngineImpl } from '../../engine/CardEngine.js';
import { SessionQueue } from '../../engine/SessionQueue.js';
import type { RuntimeAdapter, RuntimePrompt } from '../RuntimeAdapter.js';
import type { RuntimeSession } from '../RuntimeModels.js';
import type { RuntimeRegistryImpl } from '../RuntimeRegistry.js';

interface ManagedRuntimeSession {
  agent: AgentBackend;
  agentSessionId?: string;
  handler: AgentMessageHandler;
  lastPromptContext?: {
    chatId: string;
    messageId: string;
  };
}

export interface ManagedRuntimeAdapterDeps {
  registry: AgentRegistry;
  cardEngine: Pick<CardEngineImpl, 'handleMessage' | 'getStreamingState' | 'dispose'>;
  queue: SessionQueue;
  agentOpts: AgentFactoryOptions;
  runtimeRegistry?: Pick<RuntimeRegistryImpl, 'update'>;
}

export class ManagedRuntimeAdapter implements RuntimeAdapter {
  private readonly registry: AgentRegistry;
  private readonly cardEngine: Pick<CardEngineImpl, 'handleMessage' | 'getStreamingState' | 'dispose'>;
  private readonly queue: SessionQueue;
  private readonly agentOpts: AgentFactoryOptions;
  private readonly runtimeRegistry?: Pick<RuntimeRegistryImpl, 'update'>;
  private readonly sessions = new Map<string, ManagedRuntimeSession>();
  private handler: ((runtimeId: string, msg: AgentMessage) => void) | null = null;

  constructor(deps: ManagedRuntimeAdapterDeps) {
    this.registry = deps.registry;
    this.cardEngine = deps.cardEngine;
    this.queue = deps.queue;
    this.agentOpts = deps.agentOpts;
    this.runtimeRegistry = deps.runtimeRegistry;
  }

  onMessage(handler: (runtimeId: string, msg: AgentMessage) => void): void {
    this.handler = handler;
  }

  async start(runtime: RuntimeSession): Promise<void> {
    const managed = this.ensureManaged(runtime);
    if (managed.agentSessionId) {
      return;
    }

    const result = await managed.agent.startSession();
    managed.agentSessionId = result.sessionId;
    this.runtimeRegistry?.update(runtime.id, {
      status: 'idle',
      resumeHandle: {
        kind: 'claude-session',
        value: result.sessionId,
      },
      lastActiveAt: Date.now(),
    });
  }

  async sendPrompt(runtime: RuntimeSession, prompt: RuntimePrompt): Promise<void> {
    const managed = this.ensureManaged(runtime);
    managed.lastPromptContext = {
      chatId: prompt.chatId,
      messageId: prompt.messageId,
    };

    if (!managed.agentSessionId) {
      await this.start(runtime);
    }

    if (!prompt.text) {
      return;
    }

    await this.queue.enqueue(runtime.id, async () => {
      await managed.agent.sendPrompt(managed.agentSessionId!, prompt.text);
    });
  }

  async cancel(runtime: RuntimeSession): Promise<void> {
    const managed = this.sessions.get(runtime.id);
    if (!managed?.agentSessionId) {
      return;
    }

    await managed.agent.cancel(managed.agentSessionId);
    const sm = this.cardEngine.getStreamingState(runtime.id);
    if (sm) {
      sm.cancel();
    }
    this.runtimeRegistry?.update(runtime.id, {
      status: 'idle',
      lastActiveAt: Date.now(),
    });
  }

  async respondToPermission(runtime: RuntimeSession, requestId: string, approved: boolean): Promise<void> {
    const managed = this.sessions.get(runtime.id);
    if (!managed?.agent.respondToPermission) {
      return;
    }

    await managed.agent.respondToPermission(requestId, approved);
    this.runtimeRegistry?.update(runtime.id, {
      lastActiveAt: Date.now(),
    });
  }

  async dispose(runtime: RuntimeSession): Promise<void> {
    const managed = this.sessions.get(runtime.id);
    if (!managed) {
      return;
    }

    this.sessions.delete(runtime.id);
    this.cardEngine.dispose(runtime.id);

    if (managed.agent.offMessage) {
      managed.agent.offMessage(managed.handler);
    }
    await managed.agent.dispose();
    this.runtimeRegistry?.update(runtime.id, {
      status: 'stopped',
      lastActiveAt: Date.now(),
    });
  }

  private ensureManaged(runtime: RuntimeSession): ManagedRuntimeSession {
    const existing = this.sessions.get(runtime.id);
    if (existing) {
      return existing;
    }

    const agent = this.registry.create(this.resolveAgentId(runtime), this.agentOpts);
    const managed = {} as ManagedRuntimeSession;
    const handler: AgentMessageHandler = (msg) => {
      this.runtimeRegistry?.update(runtime.id, this.runtimePatchForMessage(msg));

      const chatId = managed.lastPromptContext?.chatId;
      if (chatId) {
        this.cardEngine.handleMessage(runtime.id, chatId, msg);
      }
      this.handler?.(runtime.id, msg);
    };

    managed.agent = agent;
    managed.handler = handler;
    agent.onMessage(handler);
    this.sessions.set(runtime.id, managed);
    return managed;
  }

  private resolveAgentId(runtime: RuntimeSession): AgentId {
    const metadataAgentId = runtime.metadata.agentId as AgentId | undefined;
    if (metadataAgentId) {
      return metadataAgentId;
    }

    if (runtime.provider === 'claude' && runtime.transport === 'acp') {
      return 'claude-acp';
    }
    if (runtime.provider === 'claude') {
      return 'claude';
    }
    if (runtime.provider === 'codex' && runtime.transport === 'acp') {
      return 'codex-acp';
    }
    if (runtime.provider === 'codex') {
      return 'codex';
    }
    if (runtime.provider === 'gemini') {
      return 'gemini';
    }

    return 'claude';
  }

  private runtimePatchForMessage(msg: AgentMessage): Partial<RuntimeSession> {
    if (msg.type === 'status') {
      return {
        status: msg.status,
        lastActiveAt: Date.now(),
      };
    }

    return {
      lastActiveAt: Date.now(),
    };
  }
}

export type AtlasClaudeRuntimeAdapterDeps = ManagedRuntimeAdapterDeps;
export { ManagedRuntimeAdapter as AtlasClaudeRuntimeAdapter };
