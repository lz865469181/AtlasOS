import type { Command, CommandContext } from '../CommandRegistry.js';

export const UnwatchCommand: Command = {
  name: 'unwatch',
  description: 'Clear the secondary watching runtime.',
  async execute(_args: string, context: CommandContext): Promise<string> {
    const watchRuntimeId = context.binding.watchRuntimeId;
    if (!watchRuntimeId) {
      return 'No watching runtime.';
    }

    const runtime = context.runtimeRegistry.get(watchRuntimeId);
    context.bindingStore.setWatching(context.binding.bindingId, null);

    return `Stopped watching **${runtime?.displayName ?? watchRuntimeId.slice(0, 8)}**.`;
  },
};
