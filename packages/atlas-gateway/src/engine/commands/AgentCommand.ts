import type { Command, CommandContext } from '../CommandRegistry.js';

export const AgentCommand: Command = {
  name: 'agent',
  description: 'Switch to a different agent or list available agents.',
  async execute(args: string, context: CommandContext): Promise<string> {
    const agentId = args.trim();

    if (!agentId) {
      // List active sessions' agents as a proxy for available agents
      const sessions = context.sessionManager.listActive();
      const current = context.sessionManager.get(context.chatId);
      const currentAgent = current?.agentId ?? '(none)';
      const lines = [`Current agent: ${currentAgent}`];

      if (sessions.length > 0) {
        const agents = [...new Set(sessions.map((s) => s.agentId))];
        lines.push(`Active agents: ${agents.join(', ')}`);
      }

      lines.push('Usage: /agent <agent-id> — switch agent');
      return lines.join('\n');
    }

    // Destroy old bridge session if exists
    const oldSession = context.sessionManager.get(context.chatId);
    if (oldSession) {
      await context.bridge.destroySession(oldSession.sessionId);
    }

    await context.sessionManager.switchAgent(context.chatId, agentId);
    return `Switched to agent: ${agentId}`;
  },
};
