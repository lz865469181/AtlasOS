import type { Command, CommandContext } from '../CommandRegistry.js';

export const AttachCommand: Command = {
  name: 'attach',
  description: 'Attach an existing runtime to this thread and set it as active.',
  async execute(args: string, context: CommandContext): Promise<string> {
    const prefix = args.trim();
    if (!prefix) {
      return 'Usage: /attach <name|id> - attach a runtime to this thread';
    }

    const target = context.runtimeRegistry.findByPrefix(prefix);
    if (!target) {
      return `No unique runtime found matching: ${prefix}`;
    }

    context.bindingStore.attach(context.binding.bindingId, target.id);
    context.bindingStore.setActive(context.binding.bindingId, target.id);

    const label = target.displayName ?? target.id.slice(0, 8);
    const runtimeKind = `${target.provider}/${target.transport}`;
    const routeText = target.transport === 'tmux'
      ? 'Messages in this thread will route to this tmux-backed runtime.'
      : 'Messages in this thread will route to this runtime.';
    return `Attached to **${label}** [${runtimeKind}]. ${routeText}`;
  },
};
