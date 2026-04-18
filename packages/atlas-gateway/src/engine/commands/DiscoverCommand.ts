import type { Command, CommandContext } from '../CommandRegistry.js';

export const DiscoverCommand: Command = {
  name: 'discover',
  description: 'List local tmux sessions that can be adopted into this chat.',
  async execute(_args: string, context: CommandContext): Promise<string> {
    if (!context.localRuntimeManager) {
      return 'Local tmux session discovery is unavailable on this deployment.';
    }
    if (!context.localRuntimeManager.supportsTmuxSessions) {
      return 'Local tmux session discovery is unavailable on this host.';
    }

    const sessions = await context.localRuntimeManager.discoverTmuxSessions({
      binding: context.binding,
    });

    if (sessions.length === 0) {
      return 'No local tmux sessions found.';
    }

    const lines = ['Local tmux sessions:'];
    for (let i = 0; i < sessions.length; i += 1) {
      const session = sessions[i];
      if (session.registeredRuntime) {
        const label = session.registeredRuntime.displayName ?? session.registeredRuntime.id.slice(0, 8);
        lines.push(
          `${i + 1}. ${session.sessionName} - already registered as **${label}** [${session.registeredRuntime.provider}/${session.registeredRuntime.transport}]`,
        );
        continue;
      }

      lines.push(`${i + 1}. ${session.sessionName} - adopt with \`/adopt ${session.sessionName}\``);
    }

    return lines.join('\n');
  },
};
