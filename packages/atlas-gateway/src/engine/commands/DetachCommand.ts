import type { Command, CommandContext } from '../CommandRegistry.js';

export const DetachCommand: Command = {
  name: 'detach',
  description: 'Detach the currently active runtime from this thread.',
  async execute(_args: string, context: CommandContext): Promise<string> {
    if (!context.binding.activeRuntimeId) {
      return 'No active runtime to detach.';
    }

    const activeId = context.binding.activeRuntimeId;
    context.bindingStore.detach(context.binding.bindingId, activeId);
    context.bindingStore.setActive(context.binding.bindingId, null);

    return `Detached runtime ${activeId.slice(0, 8)}.`;
  },
};
