import type { AgentMessage } from '../core/AgentMessage.js';

export interface ToolPattern {
  name: string;
  patterns: string[];
}

export interface StderrContext {
  activeToolCalls: Set<string>;
  hasActiveInvestigation: boolean;
}

export interface ToolNameContext {
  recentPromptHadChangeTitle: boolean;
  toolCallCountSincePrompt: number;
}

export interface StderrResult {
  message: AgentMessage | null;
  suppress?: boolean;
}

export interface TransportHandler {
  readonly agentName: string;
  getInitTimeout(): number;
  filterStdoutLine?(line: string): string | null;
  handleStderr?(text: string, context: StderrContext): StderrResult;
  getToolPatterns(): ToolPattern[];
  isInvestigationTool?(toolCallId: string, toolKind?: string): boolean;
  getToolCallTimeout?(toolCallId: string, toolKind?: string): number;
  extractToolNameFromId?(toolCallId: string): string | null;
  determineToolName?(
    toolName: string,
    toolCallId: string,
    input: Record<string, unknown>,
    context: ToolNameContext,
  ): string;
  getIdleTimeout?(): number;
}
