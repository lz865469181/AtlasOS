import type { Command, CommandContext } from '../CommandRegistry.js';

export const TakeoverCommand: Command = {
  name: 'takeover',
  description: 'Take over an idle session by its session ID.',
  async execute(args: string, context: CommandContext): Promise<string> {
    const targetSessionId = args.trim();

    if (!targetSessionId) {
      return 'Usage: /takeover <sessionId> — take over an idle session';
    }

    // Find the session across all active sessions
    const sessions = context.sessionManager.listActive();
    const target = sessions.find((s) => s.sessionId === targetSessionId);

    if (!target) {
      return `Session not found: ${targetSessionId}`;
    }

    await context.bridge.destroySession(targetSessionId);
    await context.sessionManager.destroy(target.chatId);
    return 'Session taken over. Previous process can be terminated.';
  },
};
