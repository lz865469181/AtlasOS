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
    const watchRuntime = context.binding.watchRuntimeId
      ? context.runtimeRegistry.get(context.binding.watchRuntimeId)
      : undefined;

    lines.push(`**Thread Runtime Roles**\n`);

    if (activeRuntime) {
      const label = activeRuntime.displayName ?? activeRuntime.id.slice(0, 8);
      lines.push(`Active: **${label}** [${activeRuntime.provider}/${activeRuntime.transport}]`);
    } else {
      lines.push('Active: (none)');
    }

    if (watchRuntime) {
      const label = watchRuntime.displayName ?? watchRuntime.id.slice(0, 8);
      lines.push(`Watching: **${label}** [${watchRuntime.provider}/${watchRuntime.transport}]`);
    }

    const secondaryRuntimeIds = context.binding.attachedRuntimeIds.filter(
      (runtimeId) => runtimeId !== context.binding.activeRuntimeId && runtimeId !== context.binding.watchRuntimeId,
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
