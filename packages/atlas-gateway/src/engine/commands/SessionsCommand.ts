import type { Command, CommandContext } from '../CommandRegistry.js';

export const SessionsCommand: Command = {
  name: 'sessions',
  description: 'List runtimes attached to this thread.',
  async execute(_args: string, context: CommandContext): Promise<string> {
    if (context.binding.attachedRuntimeIds.length === 0) {
      return 'No runtimes attached. Use /attach <id> to attach one.';
    }

    const lines: string[] = [];
    lines.push(`**Attached Runtimes (${context.binding.attachedRuntimeIds.length})**\n`);

    for (let i = 0; i < context.binding.attachedRuntimeIds.length; i++) {
      const runtimeId = context.binding.attachedRuntimeIds[i];
      const runtime = context.runtimeRegistry.get(runtimeId);
      const isActive = runtimeId === context.binding.activeRuntimeId;
      const indicator = isActive ? ' *' : '';

      if (runtime) {
        const label = runtime.displayName ?? runtimeId.slice(0, 8);
        lines.push(`${i + 1}. **${label}** [${runtime.provider}/${runtime.transport}] \`${runtimeId.slice(0, 8)}\`${indicator}`);
      } else {
        lines.push(`${i + 1}. ~~${runtimeId.slice(0, 8)}~~ (gone)`);
      }
    }

    lines.push('');
    lines.push('Use /switch <number> to switch.');
    return lines.join('\n');
  },
};
