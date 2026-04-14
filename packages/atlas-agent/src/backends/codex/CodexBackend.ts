import { Codex, type Thread, type ThreadEvent, type ThreadItem, type ThreadOptions } from '@openai/codex-sdk';
import type { AgentBackend, StartSessionResult } from '../../core/AgentBackend.js';
import type { AgentMessage, AgentMessageHandler, SessionId } from '../../core/AgentMessage.js';
import type { AgentFactoryOptions } from '../../core/AgentRegistry.js';

interface SessionState {
  thread: Thread;
  abortController: AbortController | null;
  agentMessageSnapshots: Map<string, string>;
  commandOutputSnapshots: Map<string, string>;
}

function sanitizeEnv(source: NodeJS.ProcessEnv | Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function suffixDelta(previous: string, current: string): string {
  if (!previous) {
    return current;
  }
  if (current.startsWith(previous)) {
    return current.slice(previous.length);
  }
  return current;
}

export class CodexBackend implements AgentBackend {
  private readonly client: Codex;
  private readonly threadOptions: ThreadOptions;
  private readonly sessions = new Map<SessionId, SessionState>();
  private readonly handlers = new Set<AgentMessageHandler>();

  constructor(opts: AgentFactoryOptions) {
    const env = sanitizeEnv({
      ...sanitizeEnv(process.env),
      ...(opts.env ?? {}),
    });

    const model = opts.env?.CODEX_MODEL ?? process.env.CODEX_MODEL;
    const cliPath = opts.env?.CODEX_CLI_PATH ?? process.env.CODEX_CLI_PATH;
    const apiKey =
      opts.env?.OPENAI_API_KEY
      ?? process.env.OPENAI_API_KEY
      ?? opts.env?.CODEX_API_KEY
      ?? process.env.CODEX_API_KEY;
    const baseUrl =
      opts.env?.OPENAI_BASE_URL
      ?? process.env.OPENAI_BASE_URL
      ?? opts.env?.CODEX_BASE_URL
      ?? process.env.CODEX_BASE_URL;

    this.client = new Codex({
      ...(apiKey ? { apiKey } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      ...(cliPath ? { codexPathOverride: cliPath } : {}),
      env,
    });

    this.threadOptions = {
      workingDirectory: opts.cwd,
      skipGitRepoCheck: true,
      approvalPolicy: 'never',
      sandboxMode: 'workspace-write',
      ...(model ? { model } : {}),
    };
  }

  onMessage(handler: AgentMessageHandler): void {
    this.handlers.add(handler);
  }

  offMessage(handler: AgentMessageHandler): void {
    this.handlers.delete(handler);
  }

  async startSession(): Promise<StartSessionResult> {
    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, {
      thread: this.client.startThread(this.threadOptions),
      abortController: null,
      agentMessageSnapshots: new Map(),
      commandOutputSnapshots: new Map(),
    });
    this.emit({ type: 'status', status: 'starting' });
    this.emit({ type: 'status', status: 'idle' });
    return { sessionId };
  }

  async sendPrompt(sessionId: SessionId, prompt: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }

    session.abortController = new AbortController();
    session.agentMessageSnapshots.clear();
    session.commandOutputSnapshots.clear();

    this.emit({ type: 'status', status: 'running' });

    try {
      const streamed = await session.thread.runStreamed(prompt, {
        signal: session.abortController.signal,
      });

      let terminalStatusEmitted = false;
      for await (const event of streamed.events) {
        if (this.handleEvent(session, event)) {
          terminalStatusEmitted = true;
        }
      }

      if (!terminalStatusEmitted) {
        this.emit({ type: 'status', status: 'idle' });
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      this.emit({
        type: 'status',
        status: 'error',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async cancel(sessionId: SessionId): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session?.abortController) {
      return;
    }
    session.abortController.abort();
    this.emit({ type: 'status', status: 'idle' });
  }

  async dispose(): Promise<void> {
    for (const [sessionId] of this.sessions) {
      await this.cancel(sessionId);
    }
    this.sessions.clear();
    this.handlers.clear();
  }

  private emit(message: AgentMessage): void {
    for (const handler of this.handlers) {
      handler(message);
    }
  }

  private handleEvent(session: SessionState, event: ThreadEvent): boolean {
    switch (event.type) {
      case 'item.updated':
      case 'item.completed':
        this.handleItem(session, event.item, event.type === 'item.completed');
        return false;
      case 'turn.completed':
        this.emit({ type: 'status', status: 'idle' });
        return true;
      case 'turn.failed':
        this.emit({ type: 'status', status: 'error', detail: event.error.message });
        return true;
      case 'error':
        this.emit({ type: 'status', status: 'error', detail: event.message });
        return true;
      default:
        return false;
    }
  }

  private handleItem(session: SessionState, item: ThreadItem, completed: boolean): void {
    if (item.type === 'agent_message') {
      const previous = session.agentMessageSnapshots.get(item.id) ?? '';
      const delta = suffixDelta(previous, item.text);
      if (delta) {
        this.emit({ type: 'model-output', textDelta: delta });
      }
      if (completed) {
        this.emit({ type: 'model-output', fullText: item.text });
      }
      session.agentMessageSnapshots.set(item.id, item.text);
      return;
    }

    if (item.type === 'command_execution') {
      const previous = session.commandOutputSnapshots.get(item.id) ?? '';
      const current = item.aggregated_output ?? '';
      const delta = suffixDelta(previous, current);
      if (delta) {
        this.emit({ type: 'terminal-output', data: delta });
      }
      session.commandOutputSnapshots.set(item.id, current);
      return;
    }

    if (item.type === 'error') {
      this.emit({ type: 'status', status: 'error', detail: item.message });
    }
  }
}
