import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type {
  AgentBackend,
  AgentBackendConfig,
  StartSessionResult,
} from '../../core/AgentBackend.js';
import type {
  AgentMessage,
  AgentMessageHandler,
  SessionId,
} from '../../core/AgentMessage.js';
import type { AgentFactoryOptions } from '../../core/AgentRegistry.js';

/** Read model config from ~/.claude/settings.json if available */
function readClaudeSettings(): Record<string, string> {
  try {
    const settingsPath = join(homedir(), '.claude', 'settings.json');
    const raw = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    return raw?.env ?? {};
  } catch {
    return {};
  }
}

interface SessionState {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  abortController: AbortController;
}

export type ModelTier = 'opus' | 'sonnet' | 'haiku';

const MODEL_TIER_CONFIG: Record<ModelTier, { settingsKey: string; defaultModel: string }> = {
  opus:   { settingsKey: 'ANTHROPIC_DEFAULT_OPUS_MODEL',   defaultModel: 'claude-opus-4-20250514' },
  sonnet: { settingsKey: 'ANTHROPIC_DEFAULT_SONNET_MODEL', defaultModel: 'claude-sonnet-4-20250514' },
  haiku:  { settingsKey: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',  defaultModel: 'claude-haiku-4-5-20251001' },
};

export class ClaudeBackend implements AgentBackend {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;
  private systemPrompt: string | undefined;
  private sessions = new Map<SessionId, SessionState>();
  private handlers = new Set<AgentMessageHandler>();

  constructor(opts: AgentFactoryOptions, modelTier: ModelTier = 'sonnet') {
    const settings = readClaudeSettings();
    const tierConfig = MODEL_TIER_CONFIG[modelTier];

    const apiKey =
      opts.env?.ANTHROPIC_API_KEY ??
      process.env.ANTHROPIC_API_KEY ??
      settings.ANTHROPIC_API_KEY;

    const baseURL =
      opts.env?.ANTHROPIC_BASE_URL ??
      process.env.ANTHROPIC_BASE_URL ??
      settings.ANTHROPIC_BASE_URL;

    this.client = new Anthropic({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });

    // Model resolution: explicit env > process env > settings.json > tier default
    this.model =
      opts.env?.CLAUDE_MODEL ??
      process.env.CLAUDE_MODEL ??
      settings[tierConfig.settingsKey] ??
      tierConfig.defaultModel;


    this.maxTokens = Number(opts.env?.CLAUDE_MAX_TOKENS) || 8192;
    this.systemPrompt = opts.env?.CLAUDE_SYSTEM_PROMPT;
  }

  onMessage(handler: AgentMessageHandler): void {
    this.handlers.add(handler);
  }

  offMessage(handler: AgentMessageHandler): void {
    this.handlers.delete(handler);
  }

  private emit(msg: AgentMessage): void {
    for (const handler of this.handlers) {
      handler(msg);
    }
  }

  async startSession(): Promise<StartSessionResult> {
    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, {
      messages: [],
      abortController: new AbortController(),
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

    this.emit({ type: 'status', status: 'running' });

    // Stateless: each prompt is independent (no conversation history).
    // Context memory is managed by Claude's own conversation, not by us.
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: prompt },
    ];

    // Fresh abort controller per request
    session.abortController = new AbortController();

    try {
      const stream = this.client.messages.stream(
        {
          model: this.model,
          max_tokens: this.maxTokens,
          ...(this.systemPrompt ? { system: this.systemPrompt } : {}),
          messages,
        },
        { signal: session.abortController.signal },
      );

      stream.on('text', (delta) => {
        this.emit({ type: 'model-output', textDelta: delta });
      });

      const finalMessage = await stream.finalMessage();

      const fullText = finalMessage.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      if (fullText) {
        this.emit({ type: 'model-output', fullText });
      }

      // No history accumulation — each request is standalone.

      this.emit({ type: 'status', status: 'idle' });
    } catch (err: unknown) {
      // Don't emit error for intentional abort
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      const detail = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'status', status: 'error', detail });
    }
  }

  async cancel(sessionId: SessionId): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.abortController.abort();
      this.emit({ type: 'status', status: 'idle' });
    }
  }

  async dispose(): Promise<void> {
    for (const [sessionId] of this.sessions) {
      await this.cancel(sessionId);
    }
    this.sessions.clear();
    this.handlers.clear();
  }
}
