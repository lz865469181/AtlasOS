import type { AgentMessage, AgentMessageHandler, SessionId } from './AgentMessage.js';

export type { SessionId };

export type AgentId =
  | 'claude' | 'claude-acp'
  | 'codex' | 'codex-acp'
  | 'gemini'
  | 'opencode'
  | 'openclaw'
  | 'cursor';

export type AgentTransport = 'native-claude' | 'mcp-codex' | 'acp';

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface AgentBackendConfig {
  cwd: string;
  agentName: AgentId;
  transport: AgentTransport;
  env?: Record<string, string>;
  mcpServers?: Record<string, McpServerConfig>;
}

export interface StartSessionResult {
  sessionId: SessionId;
}

export interface AgentBackend {
  startSession(initialPrompt?: string): Promise<StartSessionResult>;
  sendPrompt(sessionId: SessionId, prompt: string): Promise<void>;
  cancel(sessionId: SessionId): Promise<void>;
  onMessage(handler: AgentMessageHandler): void;
  offMessage?(handler: AgentMessageHandler): void;
  respondToPermission?(requestId: string, approved: boolean): Promise<void>;
  waitForResponseComplete?(timeoutMs?: number): Promise<void>;
  dispose(): Promise<void>;
}
