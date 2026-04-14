import type { Command, CommandContext } from '../CommandRegistry.js';

export const SessionsCommand: Command = {
  name: 'sessions',
  description: 'List runtimes attached to this thread.',
  async execute(_args: string, context: CommandContext): Promise<string> {
    if (context.binding.attachedRuntimeIds.length === 0) {
      return 'No runtimes attached. Use /attach <id> to attach one.';
    }

    const lines: string[] = [];
    const activeRuntime = context.binding.activeRuntimeId
      ? context.runtimeRegistry.get(context.binding.activeRuntimeId)
      : undefined;
    const watchRuntimeIds = context.binding.watchRuntimeIds;

    lines.push(`**Thread Runtime Roles**\n`);

    if (activeRuntime) {
      const label = activeRuntime.displayName ?? activeRuntime.id.slice(0, 8);
      lines.push(`Active: **${label}** [${activeRuntime.provider}/${activeRuntime.transport}]`);
    } else {
      lines.push('Active: (none)');
    }

    if (watchRuntimeIds.length === 0) {
      lines.push('Watching: (none)');
    }

    for (let i = 0; i < watchRuntimeIds.length; i += 1) {
      const watchRuntimeId = watchRuntimeIds[i];
      const watchRuntime = context.runtimeRegistry.get(watchRuntimeId);
      if (!watchRuntime) {
        lines.push(`Watching ${i + 1}: ~~${watchRuntimeId.slice(0, 8)}~~ (gone)`);
        continue;
      }
      const label = watchRuntime.displayName ?? watchRuntime.id.slice(0, 8);
      const watchState = context.binding.watchState[watchRuntime.id];
      const details = [
        watchState?.unreadCount ? `unread ${watchState.unreadCount}` : null,
        watchState?.lastStatus ?? null,
        watchState?.lastSummary ?? null,
      ].filter((item): item is string => Boolean(item));
      const suffix = details.length > 0 ? ` - ${details.join(' - ')}` : '';
      const prefix = watchRuntimeIds.length === 1 ? 'Watching' : `Watching ${i + 1}`;
      lines.push(`${prefix}: **${label}** [${watchRuntime.provider}/${watchRuntime.transport}]${suffix}`);
    }

    const secondaryRuntimeIds = context.binding.attachedRuntimeIds.filter(
      (runtimeId) => runtimeId !== context.binding.activeRuntimeId && !watchRuntimeIds.includes(runtimeId),
    );

    if (secondaryRuntimeIds.length > 0) {
      lines.push('');
      lines.push(`**Attached Runtimes (${secondaryRuntimeIds.length})**\n`);
    }

    for (let i = 0; i < secondaryRuntimeIds.length; i++) {
      const runtimeId = secondaryRuntimeIds[i];
      const runtime = context.runtimeRegistry.get(runtimeId);

      if (runtime) {
        const label = runtime.displayName ?? runtimeId.slice(0, 8);
        lines.push(`${i + 1}. **${label}** [${runtime.provider}/${runtime.transport}] \`${runtimeId.slice(0, 8)}\``);
      } else {
        lines.push(`${i + 1}. ~~${runtimeId.slice(0, 8)}~~ (gone)`);
      }
    }

    lines.push('');
    lines.push('Use /focus <number|name|id> to promote another runtime.');
    return lines.join('\n');
  },
};
