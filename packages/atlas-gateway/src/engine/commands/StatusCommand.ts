import type { Command, CommandContext } from '../CommandRegistry.js';

export const StatusCommand: Command = {
  name: 'status',
  description: 'Show the current session status.',
  async execute(_args: string, context: CommandContext): Promise<string> {
    const session = context.sessionManager.get(context.chatId);
    if (!session) {
      return 'No active session.';
    }

    const uptime = Math.floor((Date.now() - session.createdAt) / 1000);
    const mins = Math.floor(uptime / 60);
    const secs = uptime % 60;

    const lines = [
      `Agent: ${session.agentId}`,
      `Model: ${session.model ?? '(default)'}`,
      `Mode: ${session.permissionMode}`,
      `Uptime: ${mins}m ${secs}s`,
      `Session: ${session.sessionId}`,
    ];

    return lines.join('\n');
  },
};
