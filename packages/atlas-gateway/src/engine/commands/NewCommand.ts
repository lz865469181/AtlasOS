import type { Command, CommandContext } from '../CommandRegistry.js';
import { defaultRuntimeSpecForAgent } from '../../runtime/RuntimeSpecs.js';

export const NewCommand: Command = {
  name: 'new',
  description: 'Create a new CodeLink-managed runtime and switch this thread to it.',
  async execute(_args: string, context: CommandContext): Promise<string> {
    const runtime = await context.runtimeRegistry.create(
      defaultRuntimeSpecForAgent('claude'),
      {
        displayName: 'main',
        metadata: { permissionMode: 'normal' },
      },
    );
    context.bindingStore.attach(context.binding.bindingId, runtime.id);
    context.bindingStore.setActive(context.binding.bindingId, runtime.id);
    return `Started new runtime: ${runtime.displayName ?? runtime.id}`;
  },
};
