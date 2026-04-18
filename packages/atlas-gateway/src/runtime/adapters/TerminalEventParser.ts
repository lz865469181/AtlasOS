import type {
  AgentMessage,
  CommandExitMessage,
  CommandStartMessage,
  CwdChangeMessage,
  PermissionRequestMessage,
} from 'codelink-agent';

const MARKER_PREFIX = '@@ATLAS:';
const CMD_START_PREFIX = `${MARKER_PREFIX}CMD_START:`;
const CMD_END_PREFIX = `${MARKER_PREFIX}CMD_END:`;
const CWD_PREFIX = `${MARKER_PREFIX}CWD:`;
const PERMISSION_REQUEST_PREFIX = `${MARKER_PREFIX}PERMISSION_REQUEST:`;

type ParsedMarkerMessage =
  | CommandStartMessage
  | CommandExitMessage
  | CwdChangeMessage
  | PermissionRequestMessage;

export interface ParsedTerminalEvents {
  messages: ParsedMarkerMessage[];
  output: string;
}

export class TerminalEventParser {
  private buffer = '';

  parse(chunk: string): ParsedTerminalEvents {
    this.buffer += chunk;

    const messages: ParsedMarkerMessage[] = [];
    let output = '';

    while (true) {
      const newlineIndex = this.buffer.indexOf('\n');
      if (newlineIndex === -1) {
        break;
      }

      const lineWithBreak = this.buffer.slice(0, newlineIndex + 1);
      this.buffer = this.buffer.slice(newlineIndex + 1);

      const parsed = this.parseMarkerLine(lineWithBreak.replace(/\r?\n$/, ''));
      if (parsed) {
        messages.push(parsed);
        continue;
      }

      output += lineWithBreak;
    }

    if (this.buffer && !this.buffer.startsWith(MARKER_PREFIX)) {
      output += this.buffer;
      this.buffer = '';
    }

    return { messages, output };
  }

  private parseMarkerLine(line: string): ParsedMarkerMessage | null {
    if (line.startsWith(CMD_START_PREFIX)) {
      const payload = this.parseJson<{
        commandId?: string;
        command?: string;
        cwd?: string;
      }>(line.slice(CMD_START_PREFIX.length));
      if (payload?.commandId && payload.command) {
        return {
          type: 'command-start',
          commandId: payload.commandId,
          command: payload.command,
          ...(payload.cwd ? { cwd: payload.cwd } : {}),
        };
      }
      return null;
    }

    if (line.startsWith(CMD_END_PREFIX)) {
      const payload = this.parseJson<{
        commandId?: string;
        exitCode?: number;
      }>(line.slice(CMD_END_PREFIX.length));
      if (payload?.commandId && typeof payload.exitCode === 'number') {
        return {
          type: 'command-exit',
          commandId: payload.commandId,
          exitCode: payload.exitCode,
        };
      }
      return null;
    }

    if (line.startsWith(CWD_PREFIX)) {
      const payload = this.parseJson<{ cwd?: string }>(line.slice(CWD_PREFIX.length));
      if (payload?.cwd) {
        return {
          type: 'cwd-change',
          cwd: payload.cwd,
        };
      }
      return null;
    }

    if (line.startsWith(PERMISSION_REQUEST_PREFIX)) {
      const payload = this.parseJson<{
        id?: string;
        reason?: string;
        payload?: unknown;
      }>(line.slice(PERMISSION_REQUEST_PREFIX.length));
      if (payload?.id && payload.reason) {
        return {
          type: 'permission-request',
          id: payload.id,
          reason: payload.reason,
          payload: payload.payload ?? {},
        };
      }
      return null;
    }

    return null;
  }

  private parseJson<T>(value: string): T | null {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
}

export function isStructuredTerminalMessage(msg: AgentMessage): msg is ParsedMarkerMessage {
  return msg.type === 'command-start'
    || msg.type === 'command-exit'
    || msg.type === 'cwd-change'
    || msg.type === 'permission-request';
}
