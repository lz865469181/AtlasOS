import type { Command, CommandContext } from '../CommandRegistry.js';
import { resolveAttachedRuntime } from './runtimeTargeting.js';

export const FocusCommand: Command = {
  name: 'focus',
  aliases: ['switch'],
  description: 'Promote an attached runtime to active and keep the previous active runtime as watching.',
  async execute(args: string, context: CommandContext): Promise<string> {
    const prefix = args.trim();
    if (!prefix) {
      return 'Usage: /focus <number|name|id> - focus an attached runtime';
    }

    const { target, error } = resolveAttachedRuntime(prefix, context);
    if (!target) {
      return error ?? 'No runtime found.';
    }

    const previousActiveId = context.binding.activeRuntimeId;
    if (previousActiveId === target.id) {
      const label = target.displayName ?? target.id.slice(0, 8);
      return `Already focused on **${label}** [${target.provider}/${target.transport}].`;
    }

    context.bindingStore.attach(context.binding.bindingId, target.id);
    context.bindingStore.setActive(context.binding.bindingId, target.id);
    context.bindingStore.setWatching(
      context.binding.bindingId,
      previousActiveId && previousActiveId !== target.id ? previousActiveId : null,
    );

    const label = target.displayName ?? target.id.slice(0, 8);
    return `Focused **${label}** [${target.provider}/${target.transport}].`;
  },
};
