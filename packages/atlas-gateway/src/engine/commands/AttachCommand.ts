import type { Command, CommandContext } from '../CommandRegistry.js';

export const AttachCommand: Command = {
  name: 'attach',
  description: 'Attach a beam session to this thread and set it as active.',
  async execute(args: string, context: CommandContext): Promise<string> {
    const prefix = args.trim();
    if (!prefix) {
      return 'Usage: /attach <number|name|id> — attach a session to this thread (use /list to see available sessions)';
    }

    if (!context.threadContextStore) {
      return 'Thread context store not available.';
    }

    let target: { sessionId: string; chatId: string; agentId: string; channelId: string; displayName?: string } | null = null;

    // Try numeric index first (1-based, matching /list beam sessions order)
    const num = parseInt(prefix, 10);
    if (!isNaN(num) && String(num) === prefix) {
      const allActive = context.sessionManager.listActive();
      const beamSessions = allActive.filter(s => s.channelId === 'beam');
      if (num >= 1 && num <= beamSessions.length) {
        target = beamSessions[num - 1];
      } else {
        return `Invalid index: ${num}. There are ${beamSessions.length} beam sessions. Use /list to see them.`;
      }
    }

    // Fall back to prefix matching
    if (!target) {
      if (!context.sessionManager.findByPrefix) {
        return 'Session prefix search not supported.';
      }
      target = context.sessionManager.findByPrefix(prefix);
      if (!target) {
        return `No unique session found matching: ${prefix}`;
      }
    }

    const threadKey = context.threadKey ?? '';

    // Set ownership on the target session
    if (context.sessionManager.setOwner) {
      context.sessionManager.setOwner(target.sessionId, {
        type: 'thread',
        id: `${context.chatId}:${threadKey}`,
      });
    }

    // Attach to MRU list and set as active
    context.threadContextStore.attach(context.chatId, threadKey, target.sessionId);
    context.threadContextStore.setActive(context.chatId, threadKey, target.sessionId);

    const label = target.displayName ?? target.sessionId.slice(0, 8);
    return `Attached to **${label}** [${target.agentId}]. Messages in this thread will route to this session.`;
  },
};
