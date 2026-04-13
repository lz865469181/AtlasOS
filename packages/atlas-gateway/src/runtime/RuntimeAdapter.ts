import type { AgentMessage } from 'codelink-agent';
import type { RuntimeSession } from './RuntimeModels.js';

export interface RuntimePrompt {
  text: string;
  channelId: string;
  chatId: string;
  messageId: string;
}

export interface RuntimeAdapter {
  start(runtime: RuntimeSession): Promise<void>;
  sendPrompt(runtime: RuntimeSession, prompt: RuntimePrompt): Promise<void>;
  cancel(runtime: RuntimeSession): Promise<void>;
  respondToPermission?(runtime: RuntimeSession, requestId: string, approved: boolean): Promise<void>;
  dispose(runtime: RuntimeSession): Promise<void>;
  onMessage(handler: (runtimeId: string, msg: AgentMessage) => void): void;
}

export interface RuntimeAdapterResolver {
  resolve(runtime: RuntimeSession): RuntimeAdapter;
}
