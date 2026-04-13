import type { Command, CommandContext } from '../CommandRegistry.js';
import { defaultRuntimeSpecForAgent } from '../../runtime/RuntimeSpecs.js';

export const AgentCommand: Command = {
  name: 'agent',
  description: 'Create a runtime from a different agent spec or list the current one.',
  async execute(args: string, context: CommandContext): Promise<string> {
    const agentId = args.trim();

    if (!agentId) {
      const current = context.binding.activeRuntimeId
        ? context.runtimeRegistry.get(context.binding.activeRuntimeId)
        : undefined;
      const currentAgent = current?.provider ?? '(none)';
      return `Current agent: ${currentAgent}\nUsage: /agent <agent-id> - create a new runtime and switch to it`;
    }

    const runtime = await context.runtimeRegistry.create(
      defaultRuntimeSpecForAgent(agentId),
      {
        displayName: agentId,
        metadata: { permissionMode: 'normal' },
      },
    );

    context.bindingStore.attach(context.binding.bindingId, runtime.id);
    context.bindingStore.setActive(context.binding.bindingId, runtime.id);
    return `Switched to agent: ${agentId}`;
  },
};
