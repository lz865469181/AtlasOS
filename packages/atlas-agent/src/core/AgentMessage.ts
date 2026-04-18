export type SessionId = string;
export type ToolCallId = string;
export type AgentStatus = 'starting' | 'running' | 'idle' | 'stopped' | 'error';

export interface ModelOutputMessage {
  type: 'model-output';
  textDelta?: string;
  fullText?: string;
}

export interface StatusMessage {
  type: 'status';
  status: AgentStatus;
  detail?: string;
}

export interface ToolCallMessage {
  type: 'tool-call';
  toolName: string;
  args: Record<string, unknown>;
  callId: ToolCallId;
}

export interface ToolResultMessage {
  type: 'tool-result';
  toolName: string;
  result: unknown;
  callId: ToolCallId;
}

export interface PermissionRequestMessage {
  type: 'permission-request';
  id: string;
  reason: string;
  payload: unknown;
}

export interface PermissionResponseMessage {
  type: 'permission-response';
  id: string;
  approved: boolean;
}

export interface FsEditMessage {
  type: 'fs-edit';
  description: string;
  diff?: string;
  path?: string;
}

export interface TerminalOutputMessage {
  type: 'terminal-output';
  data: string;
}

export interface CommandStartMessage {
  type: 'command-start';
  commandId: string;
  command: string;
  cwd?: string;
}

export interface CommandExitMessage {
  type: 'command-exit';
  commandId: string;
  exitCode: number;
}

export interface CwdChangeMessage {
  type: 'cwd-change';
  cwd: string;
}

export interface EventMessage {
  type: 'event';
  name: string;
  payload: unknown;
}

export interface TokenCountMessage {
  type: 'token-count';
  [key: string]: unknown;
}

export interface ExecApprovalRequestMessage {
  type: 'exec-approval-request';
  call_id: string;
  [key: string]: unknown;
}

export interface PatchApplyBeginMessage {
  type: 'patch-apply-begin';
  call_id: string;
  auto_approved?: boolean;
  changes: Record<string, unknown>;
}

export interface PatchApplyEndMessage {
  type: 'patch-apply-end';
  call_id: string;
  stdout?: string;
  stderr?: string;
  success: boolean;
}

export type AgentMessage =
  | ModelOutputMessage
  | StatusMessage
  | ToolCallMessage
  | ToolResultMessage
  | PermissionRequestMessage
  | PermissionResponseMessage
  | FsEditMessage
  | TerminalOutputMessage
  | CommandStartMessage
  | CommandExitMessage
  | CwdChangeMessage
  | EventMessage
  | TokenCountMessage
  | ExecApprovalRequestMessage
  | PatchApplyBeginMessage
  | PatchApplyEndMessage;

export type AgentMessageHandler = (msg: AgentMessage) => void;

export function isModelOutputMessage(msg: AgentMessage): msg is ModelOutputMessage {
  return msg.type === 'model-output';
}

export function isStatusMessage(msg: AgentMessage): msg is StatusMessage {
  return msg.type === 'status';
}

export function isToolCallMessage(msg: AgentMessage): msg is ToolCallMessage {
  return msg.type === 'tool-call';
}

export function isToolResultMessage(msg: AgentMessage): msg is ToolResultMessage {
  return msg.type === 'tool-result';
}

export function isPermissionRequestMessage(msg: AgentMessage): msg is PermissionRequestMessage {
  return msg.type === 'permission-request';
}

export function getMessageText(msg: ModelOutputMessage): string {
  return msg.textDelta ?? msg.fullText ?? '';
}
