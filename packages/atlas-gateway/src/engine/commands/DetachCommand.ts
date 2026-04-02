import type { Command, CommandContext } from '../CommandRegistry.js';

export const DetachCommand: Command = {
  name: 'detach',
  description: 'Detach the currently active session from this thread.',
  async execute(_args: string, context: CommandContext): Promise<string> {
    if (!context.threadContextStore) {
      return 'Thread context store not available.';
    }

    const threadKey = context.threadKey ?? '';
    const threadCtx = context.threadContextStore.get(context.chatId, threadKey);

    if (!threadCtx || !threadCtx.activeSessionId) {
      return 'No active session to detach.';
    }

    const activeId = threadCtx.activeSessionId;

    // Clear owner on the session
    if (context.sessionManager.setOwner) {
      context.sessionManager.setOwner(activeId, undefined);
    }

    // Remove from attached list and clear active pointer
    context.threadContextStore.detach(context.chatId, threadKey, activeId);
    context.threadContextStore.setActive(context.chatId, threadKey, null);

    return `Detached session ${activeId.slice(0, 8)}. Messages will route to default session.`;
  },
};
