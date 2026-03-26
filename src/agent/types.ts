/** Options for starting a new agent session. */
export interface AgentSessionOpts {
  sessionId?: string;
  workDir: string;
  model?: string;
  mode?: string;
  env?: Record<string, string>;
  systemPrompt?: string;
  continueSession?: boolean;
}

export interface SessionInfo {
  id: string;
  name?: string;
  cwd?: string;
  lastActive?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AskQuestion {
  question: string;
  options?: string[];
  multiSelect?: boolean;
}

export type AgentEvent =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "tool_use"; tool: string; input: string }
  | { type: "tool_result"; tool: string; output: string }
  | { type: "permission_request"; id: string; tool: string; input: string; questions?: AskQuestion[] }
  | { type: "result"; content: string; sessionId?: string; usage?: TokenUsage }
  | { type: "error"; message: string };

export interface AgentSession {
  readonly sessionId: string;
  send(prompt: string): Promise<void>;
  respondPermission(allowed: boolean, message?: string): void;
  events(): AsyncIterable<AgentEvent>;
  close(): Promise<void>;
}

export interface Agent {
  readonly name: string;
  contextWindowSize?: number;
  startSession(opts: AgentSessionOpts): Promise<AgentSession>;
  listSessions(workDir: string): Promise<SessionInfo[]>;
  stop(): Promise<void>;
}

// ─── Optional Capability Interfaces ──────────────────────────────────────────

export interface ModelSwitcher {
  setModel(model: string): void;
  availableModels(): Promise<Record<string, string>>;
  currentModel(): string;
}

export interface ModeSwitcher {
  setMode(mode: string): void;
  availableModes(): string[];
  currentMode(): string;
}

export interface LiveModeSwitcher {
  setLiveMode(mode: string): Promise<void>;
}

export interface ProviderSwitcher {
  setProviders(providers: ProviderConfig[]): void;
  setActiveProvider(name: string): void;
  currentProvider(): string;
}

export interface MemoryFileProvider {
  projectMemoryFile(): string;
  globalMemoryFile(): string;
}

export interface CommandProvider {
  commandDirs(): string[];
}

export interface SkillProvider {
  skillDirs(): string[];
}

export interface ContextCompressor {
  compactCommand(): string;
}

export interface UsageReporter {
  lastUsage(): TokenUsage | undefined;
}

export interface FormattingInstructionProvider {
  formattingInstructions(platform: string): string;
}

// ─── Provider Config ─────────────────────────────────────────────────────────

export interface ProviderConfig {
  name: string;
  type: "cli" | "api";
  model: string;
  baseUrl?: string;
  apiKey?: string;
  thinking?: { type: string; budgetTokens?: number };
  env?: Record<string, string>;
}

// ─── Capability Detection Helpers ────────────────────────────────────────────

export function supportsModelSwitching(agent: Agent): agent is Agent & ModelSwitcher {
  return "setModel" in agent && "availableModels" in agent;
}

export function supportsModeSwitching(agent: Agent): agent is Agent & ModeSwitcher {
  return "setMode" in agent && "availableModes" in agent;
}

export function supportsLiveModeSwitching(session: AgentSession): session is AgentSession & LiveModeSwitcher {
  return "setLiveMode" in session;
}

export function supportsProviderSwitching(agent: Agent): agent is Agent & ProviderSwitcher {
  return "setProviders" in agent && "setActiveProvider" in agent;
}

export function supportsMemoryFiles(agent: Agent): agent is Agent & MemoryFileProvider {
  return "projectMemoryFile" in agent && "globalMemoryFile" in agent;
}

export function supportsContextCompression(agent: Agent): agent is Agent & ContextCompressor {
  return "compactCommand" in agent;
}
