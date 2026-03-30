import type {
  TransportHandler, ToolPattern, StderrContext, StderrResult, ToolNameContext,
} from './TransportHandler.js';

const DEFAULT_TIMEOUTS = {
  init: 60_000,
  toolCall: 120_000,
  investigation: 600_000,
  think: 30_000,
} as const;

export class DefaultTransport implements TransportHandler {
  readonly agentName: string;

  constructor(agentName: string = 'generic-acp') {
    this.agentName = agentName;
  }

  getInitTimeout(): number {
    return DEFAULT_TIMEOUTS.init;
  }

  filterStdoutLine(line: string): string | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed !== 'object' || parsed === null) return null;
      return line;
    } catch {
      return null;
    }
  }

  handleStderr(_text: string, _context: StderrContext): StderrResult {
    return { message: null };
  }

  getToolPatterns(): ToolPattern[] {
    return [];
  }

  isInvestigationTool(_toolCallId: string, _toolKind?: string): boolean {
    return false;
  }

  getToolCallTimeout(_toolCallId: string, toolKind?: string): number {
    if (toolKind === 'think') return DEFAULT_TIMEOUTS.think;
    return DEFAULT_TIMEOUTS.toolCall;
  }

  extractToolNameFromId(_toolCallId: string): string | null {
    return null;
  }

  determineToolName(
    toolName: string,
    _toolCallId: string,
    _input: Record<string, unknown>,
    _context: ToolNameContext,
  ): string {
    return toolName;
  }
}

export const defaultTransport = new DefaultTransport();
