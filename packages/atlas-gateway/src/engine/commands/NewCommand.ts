import type { Command, CommandContext } from '../CommandRegistry.js';

export const NewCommand: Command = {
  name: 'new',
  description: 'Reset the current session and start fresh.',
  async execute(_args: string, context: CommandContext): Promise<string> {
    const session = context.sessionManager.get(context.chatId, context.threadKey);

    if (session) {
      await context.bridge.destroySession(session.sessionId);
    }

    await context.sessionManager.destroy(context.chatId, context.threadKey);
    return 'Session reset.';
  },
};
