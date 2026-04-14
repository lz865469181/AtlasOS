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

export const ListCommand: Command = {
  name: 'list',
  description: 'List thread bindings and known runtimes.',
  async execute(_args: string, context: CommandContext): Promise<string> {
    const allBindings = context.bindingStore.listByChat(
      context.binding.channelId,
      context.binding.chatId,
    );
    const runtimes = context.runtimeRegistry.list();

    if (allBindings.length === 0 && runtimes.length === 0) {
      return 'No active runtimes.';
    }

    const lines: string[] = [];

    if (allBindings.length > 0) {
      lines.push(`**Bindings (${allBindings.length})**\n`);

      for (let i = 0; i < allBindings.length; i++) {
        const binding = allBindings[i];
        const active = timeAgo(binding.lastActiveAt);
        const threadInfo = binding.threadKey ? `thread:${binding.threadKey.slice(0, 8)}` : 'main';
        const activeRuntime = binding.activeRuntimeId
          ? context.runtimeRegistry.get(binding.activeRuntimeId)
          : undefined;
        const watchRuntimes = binding.watchRuntimeIds
          .map((runtimeId) => context.runtimeRegistry.get(runtimeId))
          .filter((entry): entry is NonNullable<typeof entry> => entry != null);
        const label = activeRuntime?.displayName ?? activeRuntime?.id.slice(0, 8) ?? '(none)';
        const runtimeKind = activeRuntime ? ` [${activeRuntime.provider}/${activeRuntime.transport}]` : '';
        const watchLabel = watchRuntimes.length > 0
          ? ` | watching: ${watchRuntimes.map((runtime) =>
            `${runtime.displayName ?? runtime.id.slice(0, 8)} [${runtime.provider}/${runtime.transport}]`).join(', ')}`
          : '';
        lines.push(`${i + 1}. **${threadInfo}** active: ${label}${runtimeKind}${watchLabel} - ${active}`);
        if (i < allBindings.length - 1) {
          lines.push('');
        }
      }
    }

    if (runtimes.length > 0) {
      if (lines.length > 0) lines.push('');
      lines.push(`**Runtimes (${runtimes.length})**\n`);

      for (let i = 0; i < runtimes.length; i++) {
        const runtime = runtimes[i];
        const label = runtime.displayName ?? runtime.id.slice(0, 8);
        const active = timeAgo(runtime.lastActiveAt);
        lines.push(`${i + 1}. **${label}** [${runtime.provider}/${runtime.transport}] \`${runtime.id.slice(0, 8)}\` - ${active}`);
      }
    }

    return lines.join('\n');
  },
};
