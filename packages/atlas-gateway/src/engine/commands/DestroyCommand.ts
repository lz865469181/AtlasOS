import type { Command, CommandContext } from '../CommandRegistry.js';

export const DestroyCommand: Command = {
  name: 'destroy',
  description: 'Destroy runtimes. Use /destroy <id> or /destroy all.',
  async execute(args: string, context: CommandContext): Promise<string> {
    const prefix = args.trim().toLowerCase();
    if (!prefix) {
      return 'Usage: /destroy <id|all> - remove runtimes';
    }

    if (prefix === 'all') {
      if (context.binding.attachedRuntimeIds.length === 0) {
        return 'No attached runtimes to destroy.';
      }

      let count = 0;
      for (const runtimeId of [...context.binding.attachedRuntimeIds]) {
        await context.runtimeBridge.dispose(runtimeId);
        context.runtimeRegistry.remove(runtimeId);
        context.bindingStore.detach(context.binding.bindingId, runtimeId);
        count++;
      }
      context.bindingStore.setActive(context.binding.bindingId, null);
      return `Destroyed **${count}** runtime(s).`;
    }

    const target = context.runtimeRegistry.findByPrefix(prefix);
    if (!target) {
      return `No runtime matches prefix: ${prefix}`;
    }

    const label = target.displayName ?? target.id;
    const shortId = target.id.slice(0, 8);

    await context.runtimeBridge.dispose(target.id);
    context.runtimeRegistry.remove(target.id);
    context.bindingStore.detach(context.binding.bindingId, target.id);
    if (context.binding.activeRuntimeId === target.id) {
      context.bindingStore.setActive(context.binding.bindingId, null);
    }

    return `Destroyed runtime **${label}** (\`${shortId}\`).`;
  },
};
