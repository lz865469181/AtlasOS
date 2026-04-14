import type { Command, CommandContext } from '../CommandRegistry.js';
import { defaultRuntimeSpecForAgent } from '../../runtime/RuntimeSpecs.js';

export const NewCommand: Command = {
  name: 'new',
  description: 'Create a new CodeLink-managed runtime and switch this thread to it.',
  async execute(_args: string, context: CommandContext): Promise<string> {
    const agentId = context.defaultAgentId ?? 'claude';
    const permissionMode = context.defaultPermissionMode ?? 'normal';
    const runtime = await context.runtimeRegistry.create(
      defaultRuntimeSpecForAgent(agentId),
      {
        displayName: 'main',
        metadata: { permissionMode },
      },
    );
    context.bindingStore.attach(context.binding.bindingId, runtime.id);
    context.bindingStore.setActive(context.binding.bindingId, runtime.id);
    return `Started new runtime: ${runtime.displayName ?? runtime.id}`;
  },
};
