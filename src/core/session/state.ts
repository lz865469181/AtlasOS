import type { AgentSession, AskQuestion } from "../../agent/types.js";
import type { ReplyContext } from "../interfaces.js";

export interface PendingPermission {
  requestId: string;
  tool: string;
  input: string;
  questions?: AskQuestion[];
  resolve: (allowed: boolean, message?: string) => void;
  resolved: boolean;
}

export interface QueuedMessage {
  text: string;
  timestamp: number;
}

export interface InteractiveState {
  sessionKey: string;
  agentSession: AgentSession;
  replyCtx: ReplyContext;
  pending?: PendingPermission;
  pendingMessages: QueuedMessage[];
  approveAll: boolean;
  quiet: boolean;
  lastActivity: number;
}

export const MAX_QUEUED_MESSAGES = 5;
