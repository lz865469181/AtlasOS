import type { Command, CommandContext } from '../CommandRegistry.js';
import { resolveAttachedRuntime } from './runtimeTargeting.js';

export const WatchCommand: Command = {
  name: 'watch',
  description: 'Mark an attached runtime as the secondary watching runtime.',
  async execute(args: string, context: CommandContext): Promise<string> {
    const prefix = args.trim();
    if (!prefix) {
      return 'Usage: /watch <number|name|id> - mark an attached runtime as watching';
    }

    const { target, error } = resolveAttachedRuntime(prefix, context);
    if (!target) {
      return error ?? 'No runtime found.';
    }

    if (context.binding.activeRuntimeId === target.id) {
      return `Runtime **${target.displayName ?? target.id.slice(0, 8)}** is already the active runtime.`;
    }

    context.bindingStore.attach(context.binding.bindingId, target.id);
    context.bindingStore.setWatching(context.binding.bindingId, target.id);

    return `Watching **${target.displayName ?? target.id.slice(0, 8)}** [${target.provider}/${target.transport}].`;
  },
};
