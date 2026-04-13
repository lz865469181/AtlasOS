import type { Command, CommandContext } from '../CommandRegistry.js';

export const CancelCommand: Command = {
  name: 'cancel',
  description: 'Cancel the currently active runtime task.',
  async execute(_args: string, context: CommandContext): Promise<string> {
    if (!context.binding.activeRuntimeId) {
      return 'No active runtime to cancel.';
    }

    await context.runtimeBridge.cancel(context.binding.activeRuntimeId);
    return 'Task cancelled.';
  },
};
