import type { Command, CommandContext } from '../CommandRegistry.js';

function timeAgo(ts: number): string {
  const diffMs = Date.now() - ts;
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

export const ListCommand: Command = {
  name: 'list',
  description: 'List all active sessions in this chat with recent messages.',
  async execute(_args: string, context: CommandContext): Promise<string> {
    if (!context.sessionManager.listByChatId) {
      return 'List command not supported by this session manager.';
    }

    const sessions = context.sessionManager.listByChatId(context.chatId);
    const allActive = context.sessionManager.listActive();
    const beamSessions = allActive.filter(s => s.channelId === 'beam');

    if (sessions.length === 0 && beamSessions.length === 0) {
      return 'No active sessions.';
    }

    const lines: string[] = [];

    // Chat-specific sessions
    if (sessions.length > 0) {
      lines.push(`**Chat Sessions (${sessions.length})**\n`);

      for (let i = 0; i < sessions.length; i++) {
        const session = sessions[i];
        const threadInfo = session.threadKey ? `thread:${session.threadKey.slice(0, 8)}` : 'main';
        const active = timeAgo(session.lastActiveAt);

        lines.push(`${i + 1}. 🟢 **${session.agentId}** [${threadInfo}] — ${active}`);

        // Show last 4 chat entries (2 pairs)
        const history = session.chatHistory;
        if (history && history.length > 0) {
          const recent = history.slice(-4);
          for (const entry of recent) {
            const icon = entry.role === 'user' ? '👤' : '🤖';
            const text = truncate(entry.text, 60);
            lines.push(`   ${icon} ${text}`);
          }
        } else if (session.lastPrompt) {
          lines.push(`   👤 ${truncate(session.lastPrompt, 60)}`);
        }

        if (i < sessions.length - 1) {
          lines.push('');
        }
      }
    }

    // Beam sessions
    if (beamSessions.length > 0) {
      if (lines.length > 0) lines.push('');
      lines.push(`**Beam Sessions (${beamSessions.length})**\n`);

      for (let i = 0; i < beamSessions.length; i++) {
        const session = beamSessions[i];
        const label = session.displayName ?? session.chatId.replace(/^beam:/, '');
        const active = timeAgo(session.lastActiveAt);
        lines.push(`${i + 1}. 🔵 **${label}** [${session.agentId}] — ${active}`);
      }
    }

    return lines.join('\n');
  },
};
