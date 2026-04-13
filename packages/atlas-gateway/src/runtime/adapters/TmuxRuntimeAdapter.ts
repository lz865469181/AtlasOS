import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentMessage, StatusMessage, TerminalOutputMessage } from 'codelink-agent';
import type { CardEngineImpl } from '../../engine/CardEngine.js';
import type { RuntimeAdapter, RuntimePrompt } from '../RuntimeAdapter.js';
import type { RuntimeSession } from '../RuntimeModels.js';
import type { RuntimeRegistryImpl } from '../RuntimeRegistry.js';

const execFileAsync = promisify(execFile);

export interface TmuxRuntimeAdapterDeps {
  cardEngine: Pick<CardEngineImpl, 'handleMessage' | 'dispose'>;
  runtimeRegistry?: Pick<RuntimeRegistryImpl, 'update'>;
  commandRunner?: (args: string[]) => Promise<string>;
  pollIntervalMs?: number;
  idleAfterMs?: number;
}

interface TmuxRuntimeState {
  poller: ReturnType<typeof setInterval> | null;
  lastCapture: string;
  lastPromptContext?: {
    chatId: string;
    messageId: string;
  };
  active: boolean;
  lastOutputAt: number;
}

function defaultCommandRunner(args: string[]): Promise<string> {
  const tmuxBin =
    process.env.CODELINK_TMUX_BIN
    ?? process.env.ATLAS_TMUX_BIN
    ?? process.env.TMUX_BIN
    ?? 'tmux';
  return execFileAsync(tmuxBin, args, {
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 8,
  }).then(({ stdout }) => stdout);
}

function captureDelta(previous: string, current: string): string {
  if (!previous) {
    return current;
  }
  if (current.startsWith(previous)) {
    return current.slice(previous.length);
  }

  let idx = 0;
  const max = Math.min(previous.length, current.length);
  while (idx < max && previous[idx] === current[idx]) {
    idx += 1;
  }
  return current.slice(idx);
}

export class TmuxRuntimeAdapter implements RuntimeAdapter {
  private readonly cardEngine: Pick<CardEngineImpl, 'handleMessage' | 'dispose'>;
  private readonly runtimeRegistry?: Pick<RuntimeRegistryImpl, 'update'>;
  private readonly commandRunner: (args: string[]) => Promise<string>;
  private readonly pollIntervalMs: number;
  private readonly idleAfterMs: number;
  private readonly states = new Map<string, TmuxRuntimeState>();
  private handler: ((runtimeId: string, msg: AgentMessage) => void) | null = null;

  constructor(deps: TmuxRuntimeAdapterDeps) {
    this.cardEngine = deps.cardEngine;
    this.runtimeRegistry = deps.runtimeRegistry;
    this.commandRunner = deps.commandRunner ?? defaultCommandRunner;
    this.pollIntervalMs = deps.pollIntervalMs ?? 1000;
    this.idleAfterMs = deps.idleAfterMs ?? 3000;
  }

  onMessage(handler: (runtimeId: string, msg: AgentMessage) => void): void {
    this.handler = handler;
  }

  async start(runtime: RuntimeSession): Promise<void> {
    const state = await this.ensureState(runtime);
    if (state.poller) {
      return;
    }

    state.lastCapture = await this.capture(runtime);
    state.poller = setInterval(() => {
      void this.poll(runtime).catch((err) => {
        this.runtimeRegistry?.update(runtime.id, {
          status: 'error',
          lastActiveAt: Date.now(),
          metadata: {
            ...runtime.metadata,
            lastError: err instanceof Error ? err.message : String(err),
          },
        });
      });
    }, this.pollIntervalMs);
  }

  async sendPrompt(runtime: RuntimeSession, prompt: RuntimePrompt): Promise<void> {
    if (!prompt.text) {
      return;
    }

    const state = await this.ensureState(runtime);
    if (!state.poller) {
      await this.start(runtime);
    }

    state.lastPromptContext = {
      chatId: prompt.chatId,
      messageId: prompt.messageId,
    };
    state.active = true;

    this.emit(runtime, {
      type: 'status',
      status: 'running',
      detail: 'Forwarded prompt to tmux runtime',
    });

    const target = this.tmuxTarget(runtime);
    await this.commandRunner(['set-buffer', '--', prompt.text]);
    await this.commandRunner(['paste-buffer', '-t', target]);
    await this.commandRunner(['send-keys', '-t', target, 'Enter']);
  }

  async cancel(runtime: RuntimeSession): Promise<void> {
    await this.commandRunner(['send-keys', '-t', this.tmuxTarget(runtime), 'C-c']);
    this.runtimeRegistry?.update(runtime.id, {
      status: 'idle',
      lastActiveAt: Date.now(),
    });
  }

  async dispose(runtime: RuntimeSession): Promise<void> {
    const state = this.states.get(runtime.id);
    if (state?.poller) {
      clearInterval(state.poller);
    }
    this.states.delete(runtime.id);
    this.cardEngine.dispose(runtime.id);

    if (runtime.metadata.tmuxManaged === 'true') {
      await this.commandRunner(['kill-session', '-t', this.tmuxSessionName(runtime)]);
    }

    this.runtimeRegistry?.update(runtime.id, {
      status: 'stopped',
      lastActiveAt: Date.now(),
    });
  }

  private async ensureState(runtime: RuntimeSession): Promise<TmuxRuntimeState> {
    const existing = this.states.get(runtime.id);
    if (existing) {
      return existing;
    }

    const created: TmuxRuntimeState = {
      poller: null,
      lastCapture: '',
      active: false,
      lastOutputAt: Date.now(),
    };
    this.states.set(runtime.id, created);
    return created;
  }

  private async poll(runtime: RuntimeSession): Promise<void> {
    const state = this.states.get(runtime.id);
    if (!state) {
      return;
    }

    const current = await this.capture(runtime);
    const delta = captureDelta(state.lastCapture, current);
    state.lastCapture = current;

    if (delta) {
      state.lastOutputAt = Date.now();
      this.emit(runtime, {
        type: 'terminal-output',
        data: delta,
      });
      return;
    }

    if (state.active && Date.now() - state.lastOutputAt >= this.idleAfterMs) {
      state.active = false;
      this.emit(runtime, {
        type: 'status',
        status: 'idle',
        detail: 'tmux runtime is quiescent',
      });
    }
  }

  private async capture(runtime: RuntimeSession): Promise<string> {
    return this.commandRunner(['capture-pane', '-p', '-t', this.tmuxTarget(runtime)]);
  }

  private emit(runtime: RuntimeSession, msg: StatusMessage | TerminalOutputMessage): void {
    this.runtimeRegistry?.update(runtime.id, this.runtimePatchForMessage(msg));

    const state = this.states.get(runtime.id);
    const chatId = state?.lastPromptContext?.chatId;
    if (chatId && msg.type === 'terminal-output') {
      this.cardEngine.handleMessage(runtime.id, chatId, msg);
    }
    this.handler?.(runtime.id, msg);
  }

  private runtimePatchForMessage(msg: StatusMessage | TerminalOutputMessage): Partial<RuntimeSession> {
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

  private tmuxTarget(runtime: RuntimeSession): string {
    return runtime.metadata.tmuxTarget || `${this.tmuxSessionName(runtime)}:0.0`;
  }

  private tmuxSessionName(runtime: RuntimeSession): string {
    if (runtime.metadata.tmuxSessionName) {
      return runtime.metadata.tmuxSessionName;
    }
    if (runtime.resumeHandle?.kind === 'tmux-session') {
      return runtime.resumeHandle.value;
    }
    return runtime.id;
  }
}
