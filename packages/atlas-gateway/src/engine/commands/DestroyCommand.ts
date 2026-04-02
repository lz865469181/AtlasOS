import type { Command, CommandContext } from '../CommandRegistry.js';

export const DestroyCommand: Command = {
  name: 'destroy',
  description: 'Destroy session(s). Use /destroy all to clear all chat sessions, or /destroy <id> for a specific one.',
  async execute(args: string, context: CommandContext): Promise<string> {
    const prefix = args.trim().toLowerCase();
    if (!prefix) {
      return 'Usage: /destroy <number|id|all> — remove sessions (use /list to see IDs)';
    }

    // "all" — destroy all sessions for this chat
    if (prefix === 'all') {
      if (!context.sessionManager.listByChatId) {
        return 'List by chat not supported.';
      }
      const chatSessions = context.sessionManager.listByChatId(context.chatId);
      if (chatSessions.length === 0) {
        return 'No chat sessions to destroy.';
      }

      let count = 0;
      for (const session of chatSessions) {
        try { await context.bridge.destroySession(session.sessionId); } catch { /* ignore */ }
        if (context.sessionManager.removeBySessionId) {
          context.sessionManager.removeBySessionId(session.sessionId);
        }
        count++;
      }
      return `Destroyed **${count}** chat session(s).`;
    }

    // Try numeric index (matches /list chat sessions order)
    const allSessions = context.sessionManager.listActive();
    let target: (typeof allSessions)[number] | undefined;

    const num = parseInt(prefix, 10);
    if (!isNaN(num) && String(num) === prefix) {
      // Index into chat sessions for this chat
      if (context.sessionManager.listByChatId) {
        const chatSessions = context.sessionManager.listByChatId(context.chatId);
        if (num >= 1 && num <= chatSessions.length) {
          const cs = chatSessions[num - 1];
          target = allSessions.find(s => s.sessionId === cs.sessionId);
        }
      }
      // If not found in chat sessions, try beam sessions
      if (!target) {
        const beamSessions = allSessions.filter(s => s.channelId === 'beam');
        if (num >= 1 && num <= beamSessions.length) {
          target = beamSessions[num - 1];
        }
      }
      if (!target) {
        return `Invalid index: ${num}. Use /list to see sessions.`;
      }
    }

    // Fall back to prefix matching
    if (!target) {
      const matched = allSessions.filter(s => s.sessionId.toLowerCase().startsWith(prefix));
      if (matched.length === 0) {
        return `No session matches prefix: ${prefix}`;
      }
      if (matched.length > 1) {
        return `Ambiguous: ${prefix} matches ${matched.length} sessions. Be more specific.`;
      }
      target = matched[0];
    }

    const label = target.displayName ?? target.agentId;
    const shortId = target.sessionId.slice(0, 8);

    await context.bridge.destroySession(target.sessionId);
    if (context.sessionManager.removeBySessionId) {
      context.sessionManager.removeBySessionId(target.sessionId);
    }

    return `Destroyed session **${label}** (\`${shortId}\`).`;
  },
};
