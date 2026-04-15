import type { Command, CommandContext } from '../CommandRegistry.js';
import { defaultRuntimeSpecForAgent } from '../../runtime/RuntimeSpecs.js';

export const NewCommand: Command = {
  name: 'new',
  description: 'Create a new CodeLink-managed runtime and switch this thread to it.',
  async execute(_args: string, context: CommandContext): Promise<string> {
    const agentId = context.defaultAgentId ?? 'claude';
    const permissionMode = context.defaultPermissionMode ?? 'normal';
    const spec = defaultRuntimeSpecForAgent(agentId);

    if (context.localRuntimeManager && (spec.provider === 'claude' || spec.provider === 'codex')) {
      const started = await context.localRuntimeManager.startTmuxRuntime({
        provider: spec.provider,
        name: 'main',
        displayName: 'main',
        sessionName: `main-${Date.now().toString(36)}`,
        binding: context.binding,
      });
      context.bindingStore.attach(context.binding.bindingId, started.runtime.id);
      context.bindingStore.setActive(context.binding.bindingId, started.runtime.id);
      const label = started.runtime.displayName ?? started.runtime.id.slice(0, 8);
      return `Started new runtime: ${label} [${started.runtime.provider}/${started.runtime.transport}]`;
    }

    const runtime = await context.runtimeRegistry.create(
      spec,
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
