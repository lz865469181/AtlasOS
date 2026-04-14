import { resolveAttachedRuntime } from './runtimeTargeting.js';
import type { Command, CommandContext } from '../CommandRegistry.js';

export const UnwatchCommand: Command = {
  name: 'unwatch',
  description: 'Clear one watching runtime, or all of them when no target is provided.',
  async execute(args: string, context: CommandContext): Promise<string> {
    if (context.binding.watchRuntimeIds.length === 0) {
      return 'No watching runtime.';
    }

    const prefix = args.trim();
    if (!prefix) {
      const labels = context.binding.watchRuntimeIds.map((runtimeId) => {
        const runtime = context.runtimeRegistry.get(runtimeId);
        return `**${runtime?.displayName ?? runtimeId.slice(0, 8)}**`;
      });
      context.bindingStore.clearWatching(context.binding.bindingId);
      return `Stopped watching ${labels.join(', ')}.`;
    }

    const { target, error } = resolveAttachedRuntime(prefix, context);
    if (!target) {
      return error ?? 'No runtime found.';
    }
    if (!context.binding.watchRuntimeIds.includes(target.id)) {
      return `Runtime **${target.displayName ?? target.id.slice(0, 8)}** is not being watched.`;
    }

    context.bindingStore.removeWatching(context.binding.bindingId, target.id);
    return `Stopped watching **${target.displayName ?? target.id.slice(0, 8)}**.`;
  },
};
