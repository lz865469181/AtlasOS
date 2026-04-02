import type { Command, CommandContext } from '../CommandRegistry.js';

export const SwitchCommand: Command = {
  name: 'switch',
  description: 'Switch the active session to another already-attached session.',
  async execute(args: string, context: CommandContext): Promise<string> {
    const prefix = args.trim();
    if (!prefix) {
      return 'Usage: /switch <number|name|id> — switch to an attached session (use /sessions to see list)';
    }

    if (!context.threadContextStore) {
      return 'Thread context store not available.';
    }

    const threadKey = context.threadKey ?? '';
    const threadCtx = context.threadContextStore.get(context.chatId, threadKey);

    if (!threadCtx || threadCtx.attachedSessions.length === 0) {
      return 'No sessions attached to this thread. Use /attach <id> first.';
    }

    const allSessions = context.sessionManager.listActive();
    const attachedDetails = threadCtx.attachedSessions
      .map(id => allSessions.find(s => s.sessionId === id))
      .filter((s): s is NonNullable<typeof s> => s != null);

    let target: (typeof attachedDetails)[number] | undefined;

    // Try numeric index first (1-based, matching /sessions order)
    const num = parseInt(prefix, 10);
    if (!isNaN(num) && String(num) === prefix && num >= 1 && num <= attachedDetails.length) {
      target = attachedDetails[num - 1];
    }

    if (!target) {
      // Try exact displayName, then prefix on name, then prefix on sessionId
      const lower = prefix.toLowerCase();
      let matched = attachedDetails.filter(s => s.displayName?.toLowerCase() === lower);
      if (matched.length === 0) {
        matched = attachedDetails.filter(s => s.displayName?.toLowerCase().startsWith(lower));
      }
      if (matched.length === 0) {
        matched = attachedDetails.filter(s => s.sessionId.toLowerCase().startsWith(lower));
      }

      if (matched.length === 0) {
        return `No attached session matches: ${prefix}. Use /sessions to see attached sessions.`;
      }
      if (matched.length > 1) {
        return `Ambiguous: ${prefix} matches ${matched.length} sessions. Be more specific.`;
      }
      target = matched[0];
    }

    const targetId = target.sessionId;

    // Re-takeover: set owner
    if (context.sessionManager.setOwner) {
      context.sessionManager.setOwner(targetId, {
        type: 'thread',
        id: `${context.chatId}:${threadKey}`,
      });
    }

    // Set as active and move to front of MRU
    context.threadContextStore.setActive(context.chatId, threadKey, targetId);
    context.threadContextStore.attach(context.chatId, threadKey, targetId); // moves to front

    const label = target.displayName ?? targetId.slice(0, 8);
    return `Switched to **${label}** [${target.agentId}].`;
  },
};
