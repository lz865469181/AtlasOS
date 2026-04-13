export interface RuntimeCapabilities {
  streaming: boolean;
  permissionCards: boolean;
  fileAccess: boolean;
  imageInput: boolean;
  terminalOutput: boolean;
  patchEvents: boolean;
}

export interface RuntimeSession {
  id: string;
  source: 'atlas-managed' | 'external' | 'remote';
  provider: 'claude' | 'codex' | 'gemini' | 'custom';
  transport: 'sdk' | 'acp' | 'mcp' | 'websocket' | 'bridge' | 'tmux';
  status: 'starting' | 'running' | 'idle' | 'paused' | 'error' | 'stopped';
  displayName?: string;
  workspaceId?: string;
  projectId?: string;
  resumeHandle?: { kind: 'claude-session' | 'tmux-session' | 'remote-runtime'; value: string };
  capabilities: RuntimeCapabilities;
  metadata: Record<string, string>;
  createdAt: number;
  lastActiveAt: number;
}

export interface AgentSpec {
  id: string;
  provider: RuntimeSession['provider'];
  transport: RuntimeSession['transport'];
  displayName: string;
  defaultCapabilities: RuntimeCapabilities;
}

export interface ConversationBinding {
  bindingId: string;
  channelId: string;
  chatId: string;
  threadKey: string;
  activeRuntimeId: string | null;
  attachedRuntimeIds: string[];
  defaultRuntimeId: string | null;
  createdAt: number;
  lastActiveAt: number;
}
