import type { AgentMessage } from 'codelink-agent';
import type { CardEngineImpl } from '../../engine/CardEngine.js';
import type { RuntimeAdapter, RuntimePrompt } from '../RuntimeAdapter.js';
import type { RuntimeSession } from '../RuntimeModels.js';
import type { RuntimeRegistryImpl } from '../RuntimeRegistry.js';
import { encodeRuntimePermissionResponse, encodeRuntimePrompt } from './RuntimeInputEncoding.js';
import { TerminalEventParser } from './TerminalEventParser.js';

export interface PtyTerminal {
  pid: number;
  write(data: string): void;
  kill(): void;
  onData?(handler: (data: string) => void): void;
  onExit?(handler: (event: { exitCode: number; signal?: number }) => void): void;
  on?(event: 'data' | 'exit', handler: (...args: any[]) => void): void;
}

export interface PtyRuntimeAdapterDeps {
  cardEngine: Pick<CardEngineImpl, 'handleMessage' | 'dispose'>;
  runtimeRegistry?: Pick<RuntimeRegistryImpl, 'update'>;
  spawnTerminal: (runtime: RuntimeSession) => PtyTerminal;
  idleAfterMs?: number;
}

interface PtyRuntimeState {
  terminal: PtyTerminal;
  parser: TerminalEventParser;
  lastPromptContext?: {
    chatId: string;
    messageId: string;
  };
  active: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

function installDataListener(terminal: PtyTerminal, handler: (data: string) => void): void {
  if (typeof terminal.onData === 'function') {
    terminal.onData(handler);
    return;
  }
  terminal.on?.('data', handler);
}

function installExitListener(
  terminal: PtyTerminal,
  handler: (event: { exitCode: number; signal?: number }) => void,
): void {
  if (typeof terminal.onExit === 'function') {
    terminal.onExit(handler);
    return;
  }
  terminal.on?.('exit', handler);
}

export class PtyRuntimeAdapter implements RuntimeAdapter {
  private readonly cardEngine: Pick<CardEngineImpl, 'handleMessage' | 'dispose'>;
  private readonly runtimeRegistry?: Pick<RuntimeRegistryImpl, 'update'>;
  private readonly spawnTerminal: (runtime: RuntimeSession) => PtyTerminal;
  private readonly idleAfterMs: number;
  private readonly states = new Map<string, PtyRuntimeState>();
  private handler: ((runtimeId: string, msg: AgentMessage) => void) | null = null;

  constructor(deps: PtyRuntimeAdapterDeps) {
    this.cardEngine = deps.cardEngine;
    this.runtimeRegistry = deps.runtimeRegistry;
    this.spawnTerminal = deps.spawnTerminal;
    this.idleAfterMs = deps.idleAfterMs ?? 3000;
  }

  onMessage(handler: (runtimeId: string, msg: AgentMessage) => void): void {
    this.handler = handler;
  }

  async start(runtime: RuntimeSession): Promise<void> {
    if (this.states.has(runtime.id)) {
      return;
    }

    const terminal = this.spawnTerminal(runtime);
    const state: PtyRuntimeState = {
      terminal,
      parser: new TerminalEventParser(),
      active: false,
      idleTimer: null,
    };
    this.states.set(runtime.id, state);

    installDataListener(terminal, (data) => {
      this.handleTerminalData(runtime, data);
    });
    installExitListener(terminal, (event) => {
      this.handleTerminalExit(runtime, event);
    });

    this.runtimeRegistry?.update(runtime.id, {
      status: 'idle',
      lastActiveAt: Date.now(),
      metadata: {
        ...runtime.metadata,
        ptyPid: String(terminal.pid),
      },
    });
  }

  async sendPrompt(runtime: RuntimeSession, prompt: RuntimePrompt): Promise<void> {
    if (!prompt.text) {
      return;
    }

    await this.start(runtime);
    const state = this.states.get(runtime.id);
    if (!state) {
      throw new Error(`Unknown pty runtime state: ${runtime.id}`);
    }

    state.lastPromptContext = {
      chatId: prompt.chatId,
      messageId: prompt.messageId,
    };
    state.active = true;
    this.clearIdleTimer(state);

    this.emit(runtime, {
      type: 'status',
      status: 'running',
      detail: 'Forwarded prompt to pty runtime',
    });
    state.terminal.write(`${encodeRuntimePrompt(runtime, prompt.text)}\r`);
  }

  async cancel(runtime: RuntimeSession): Promise<void> {
    const state = this.states.get(runtime.id);
    if (!state) {
      return;
    }
    state.terminal.write('\u0003');
    this.runtimeRegistry?.update(runtime.id, {
      status: 'idle',
      lastActiveAt: Date.now(),
    });
  }

  async respondToPermission(runtime: RuntimeSession, requestId: string, approved: boolean): Promise<void> {
    const frame = encodeRuntimePermissionResponse(runtime, requestId, approved);
    if (!frame) {
      return;
    }

    await this.start(runtime);
    const state = this.states.get(runtime.id);
    if (!state) {
      throw new Error(`Unknown pty runtime state: ${runtime.id}`);
    }

    state.terminal.write(`${frame}\r`);
    this.runtimeRegistry?.update(runtime.id, {
      lastActiveAt: Date.now(),
    });
  }

  async dispose(runtime: RuntimeSession): Promise<void> {
    const state = this.states.get(runtime.id);
    if (state) {
      this.clearIdleTimer(state);
      state.terminal.kill();
    }
    this.states.delete(runtime.id);
    this.cardEngine.dispose(runtime.id);
    this.runtimeRegistry?.update(runtime.id, {
      status: 'stopped',
      lastActiveAt: Date.now(),
    });
  }

  private handleTerminalData(runtime: RuntimeSession, data: string): void {
    const state = this.states.get(runtime.id);
    if (!state) {
      return;
    }

    state.active = true;
    this.scheduleIdle(runtime, state);
    const parsed = state.parser.parse(data);

    for (const message of parsed.messages) {
      this.emit(runtime, message);
    }

    if (parsed.output) {
      this.emit(runtime, {
        type: 'terminal-output',
        data: parsed.output,
      });
    }
  }

  private handleTerminalExit(runtime: RuntimeSession, event: { exitCode: number; signal?: number }): void {
    const state = this.states.get(runtime.id);
    if (state) {
      this.clearIdleTimer(state);
    }

    this.runtimeRegistry?.update(runtime.id, {
      status: 'stopped',
      lastActiveAt: Date.now(),
      metadata: {
        ...runtime.metadata,
        ptyExitCode: String(event.exitCode),
        ...(event.signal != null ? { ptySignal: String(event.signal) } : {}),
      },
    });

    this.emit(runtime, {
      type: 'status',
      status: 'stopped',
      detail: `pty runtime exited with code ${event.exitCode}`,
    });
  }

  private scheduleIdle(runtime: RuntimeSession, state: PtyRuntimeState): void {
    this.clearIdleTimer(state);
    state.idleTimer = setTimeout(() => {
      if (!state.active) {
        return;
      }
      state.active = false;
      this.emit(runtime, {
        type: 'status',
        status: 'idle',
        detail: 'pty runtime is quiescent',
      });
    }, this.idleAfterMs);
  }

  private clearIdleTimer(state: PtyRuntimeState): void {
    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
      state.idleTimer = null;
    }
  }

  private emit(runtime: RuntimeSession, msg: AgentMessage): void {
    this.runtimeRegistry?.update(runtime.id, this.runtimePatchForMessage(msg));

    const state = this.states.get(runtime.id);
    const chatId = state?.lastPromptContext?.chatId;
    if (chatId && msg.type !== 'status') {
      this.cardEngine.handleMessage(runtime.id, chatId, msg);
    }
    this.handler?.(runtime.id, msg);
  }

  private runtimePatchForMessage(msg: AgentMessage): Partial<RuntimeSession> {
    if (msg.type === 'status') {
      return {
        status: msg.status,
        lastActiveAt: Date.now(),
      };
    }

    if (msg.type === 'command-start') {
      return {
        status: 'running',
        lastActiveAt: Date.now(),
      };
    }

    if (msg.type === 'permission-request' || msg.type === 'exec-approval-request') {
      return {
        status: 'paused',
        lastActiveAt: Date.now(),
      };
    }

    return {
      lastActiveAt: Date.now(),
    };
  }
}
