import type { Command, CommandContext } from '../CommandRegistry.js';

export const CancelCommand: Command = {
  name: 'cancel',
  description: 'Cancel the currently running agent task.',
  async execute(_args: string, context: CommandContext): Promise<string> {
    const session = context.sessionManager.get(context.chatId);
    if (!session) {
      return 'No active session to cancel.';
    }

    await context.bridge.cancelSession(session.sessionId);
    return 'Task cancelled.';
  },
};
