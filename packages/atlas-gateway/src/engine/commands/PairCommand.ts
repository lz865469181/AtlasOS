import type { Command, CommandContext } from '../CommandRegistry.js';
import { resolveRuntimeAny } from './runtimeTargeting.js';

export const PairCommand: Command = {
  name: 'pair',
  description: 'Attach two runtimes to this thread, set the first as active and the second as watching.',
  async execute(args: string, context: CommandContext): Promise<string> {
    const parts = args.trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
      return 'Usage: /pair <active-name|id> <watch-name|id>'; 
    }

    const [activeArg, watchArg] = parts;

    const activeRes = resolveRuntimeAny(activeArg, context);
    if (!activeRes.target) {
      return activeRes.error ?? `No runtime found for ${activeArg}.`;
    }

    const watchRes = resolveRuntimeAny(watchArg, context);
    if (!watchRes.target) {
      return watchRes.error ?? `No runtime found for ${watchArg}.`;
    }

    if (activeRes.target.id === watchRes.target.id) {
      return 'Active and watching targets must be different.';
    }

    const active = activeRes.target;
    const watch = watchRes.target;

    context.bindingStore.attach(context.binding.bindingId, active.id);
    context.bindingStore.attach(context.binding.bindingId, watch.id);

    context.bindingStore.setActive(context.binding.bindingId, active.id);
    context.bindingStore.addWatching(context.binding.bindingId, watch.id);

    const activeLabel = active.displayName ?? active.id.slice(0, 8);
    const watchLabel = watch.displayName ?? watch.id.slice(0, 8);

    return `Paired runtimes. Active: **${activeLabel}** [${active.provider}/${active.transport}]. Watching: **${watchLabel}** [${watch.provider}/${watch.transport}].`;
  },
};
