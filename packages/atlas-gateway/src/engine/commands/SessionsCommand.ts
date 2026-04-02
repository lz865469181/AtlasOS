import type { Command, CommandContext } from '../CommandRegistry.js';

export const SessionsCommand: Command = {
  name: 'sessions',
  description: 'List sessions attached to this thread.',
  async execute(_args: string, context: CommandContext): Promise<string> {
    if (!context.threadContextStore) {
      return 'Thread context store not available.';
    }

    const threadKey = context.threadKey ?? '';
    const threadCtx = context.threadContextStore.get(context.chatId, threadKey);

    if (!threadCtx || threadCtx.attachedSessions.length === 0) {
      return 'No sessions attached. Use /attach <id> to attach one.';
    }

    const allSessions = context.sessionManager.listActive();
    const lines: string[] = [];
    lines.push(`**Attached Sessions (${threadCtx.attachedSessions.length})**\n`);

    for (let i = 0; i < threadCtx.attachedSessions.length; i++) {
      const sessionId = threadCtx.attachedSessions[i];
      const session = allSessions.find(s => s.sessionId === sessionId);
      const isActive = sessionId === threadCtx.activeSessionId;
      const indicator = isActive ? ' ▶' : '';

      if (session) {
        const label = session.displayName ?? sessionId.slice(0, 8);
        lines.push(`${i + 1}. **${label}** [${session.agentId}] \`${sessionId.slice(0, 8)}\`${indicator}`);
      } else {
        lines.push(`${i + 1}. ~~${sessionId.slice(0, 8)}~~ (gone)`);
      }
    }

    lines.push('');
    lines.push('Use /switch <number> to switch.');

    return lines.join('\n');
  },
};
