import type { Command, CommandContext } from '../CommandRegistry.js';

export const SwitchCommand: Command = {
  name: 'switch',
  description: 'Switch the active runtime to another already-attached runtime.',
  async execute(args: string, context: CommandContext): Promise<string> {
    const prefix = args.trim();
    if (!prefix) {
      return 'Usage: /switch <number|name|id> - switch to an attached runtime';
    }

    if (context.binding.attachedRuntimeIds.length === 0) {
      return 'No runtimes attached to this thread. Use /attach <id> first.';
    }

    const attachedDetails = context.binding.attachedRuntimeIds
      .map(id => context.runtimeRegistry.get(id))
      .filter((runtime): runtime is NonNullable<typeof runtime> => runtime != null);

    let target: (typeof attachedDetails)[number] | undefined;

    const num = parseInt(prefix, 10);
    if (!Number.isNaN(num) && String(num) === prefix && num >= 1 && num <= attachedDetails.length) {
      target = attachedDetails[num - 1];
    }

    if (!target) {
      const lower = prefix.toLowerCase();
      let matched = attachedDetails.filter(runtime => runtime.displayName?.toLowerCase() === lower);
      if (matched.length === 0) {
        matched = attachedDetails.filter(runtime => runtime.displayName?.toLowerCase().startsWith(lower));
      }
      if (matched.length === 0) {
        matched = attachedDetails.filter(runtime => runtime.id.toLowerCase().startsWith(lower));
      }

      if (matched.length === 0) {
        return `No attached runtime matches: ${prefix}. Use /sessions to see attached runtimes.`;
      }
      if (matched.length > 1) {
        return `Ambiguous: ${prefix} matches ${matched.length} runtimes. Be more specific.`;
      }
      target = matched[0];
    }

    context.bindingStore.setActive(context.binding.bindingId, target.id);
    context.bindingStore.attach(context.binding.bindingId, target.id);

    const label = target.displayName ?? target.id.slice(0, 8);
    return `Switched to **${label}** [${target.provider}].`;
  },
};
