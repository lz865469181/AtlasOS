import type { AgentMessage } from 'codelink-agent';
import type { CardEngineImpl } from '../../engine/CardEngine.js';
import type { RuntimeAdapter, RuntimePrompt } from '../RuntimeAdapter.js';
import type { RuntimeSession } from '../RuntimeModels.js';
import type { RuntimeRegistryImpl } from '../RuntimeRegistry.js';

export type ExternalRuntimeInboxItem =
  | { kind: 'prompt'; prompt: RuntimePrompt }
  | { kind: 'cancel' }
  | { kind: 'permission-response'; requestId: string; approved: boolean };

interface ExternalRuntimeState {
  inbox: ExternalRuntimeInboxItem[];
  lastChatId?: string;
}

export interface ExternalRuntimeAdapterDeps {
  cardEngine: Pick<CardEngineImpl, 'handleMessage' | 'dispose'>;
  runtimeRegistry?: Pick<RuntimeRegistryImpl, 'update'>;
}

export class ExternalRuntimeAdapter implements RuntimeAdapter {
  private readonly cardEngine: Pick<CardEngineImpl, 'handleMessage' | 'dispose'>;
  private readonly runtimeRegistry?: Pick<RuntimeRegistryImpl, 'update'>;
  private readonly states = new Map<string, ExternalRuntimeState>();
  private handler: ((runtimeId: string, msg: AgentMessage) => void) | null = null;

  constructor(deps: ExternalRuntimeAdapterDeps) {
    this.cardEngine = deps.cardEngine;
    this.runtimeRegistry = deps.runtimeRegistry;
  }

  onMessage(handler: (runtimeId: string, msg: AgentMessage) => void): void {
    this.handler = handler;
  }

  async start(runtime: RuntimeSession): Promise<void> {
    this.ensureState(runtime.id);
  }

  async sendPrompt(runtime: RuntimeSession, prompt: RuntimePrompt): Promise<void> {
    const state = this.ensureState(runtime.id);
    state.lastChatId = prompt.chatId;
    state.inbox.push({ kind: 'prompt', prompt });
    this.touchRuntime(runtime.id, { status: 'running' });
  }

  async cancel(runtime: RuntimeSession): Promise<void> {
    this.ensureState(runtime.id).inbox.push({ kind: 'cancel' });
    this.touchRuntime(runtime.id, { status: 'idle' });
  }

  async respondToPermission(runtime: RuntimeSession, requestId: string, approved: boolean): Promise<void> {
    this.ensureState(runtime.id).inbox.push({
      kind: 'permission-response',
      requestId,
      approved,
    });
    this.touchRuntime(runtime.id);
  }

  async dispose(runtime: RuntimeSession): Promise<void> {
    this.states.delete(runtime.id);
    this.cardEngine.dispose(runtime.id);
    this.touchRuntime(runtime.id, { status: 'stopped' });
  }

  drainInbox(runtimeId: string): ExternalRuntimeInboxItem[] {
    const state = this.ensureState(runtimeId);
    const items = [...state.inbox];
    state.inbox.length = 0;
    return items;
  }

  ingest(runtime: RuntimeSession, message: AgentMessage, opts?: { chatId?: string }): void {
    const state = this.ensureState(runtime.id);
    const chatId = opts?.chatId ?? state.lastChatId ?? runtime.metadata.lastChatId;

    this.touchRuntime(runtime.id, this.runtimePatchForMessage(message));

    if (chatId) {
      this.cardEngine.handleMessage(runtime.id, chatId, message);
    }
    this.handler?.(runtime.id, message);
  }

  private ensureState(runtimeId: string): ExternalRuntimeState {
    const existing = this.states.get(runtimeId);
    if (existing) {
      return existing;
    }

    const created: ExternalRuntimeState = {
      inbox: [],
    };
    this.states.set(runtimeId, created);
    return created;
  }

  private runtimePatchForMessage(message: AgentMessage): Partial<RuntimeSession> {
    if (message.type === 'status') {
      return {
        status: message.status,
        lastActiveAt: Date.now(),
      };
    }

    return {
      lastActiveAt: Date.now(),
    };
  }

  private touchRuntime(runtimeId: string, patch?: Partial<RuntimeSession>): void {
    this.runtimeRegistry?.update(runtimeId, {
      lastActiveAt: Date.now(),
      ...(patch ?? {}),
    });
  }
}
