import type { Command, CommandContext } from '../CommandRegistry.js';

export const ModelCommand: Command = {
  name: 'model',
  description: 'Switch the AI model for the current runtime.',
  async execute(args: string, context: CommandContext): Promise<string> {
    const modelName = args.trim();
    const runtime = context.binding.activeRuntimeId
      ? context.runtimeRegistry.get(context.binding.activeRuntimeId)
      : undefined;

    if (!modelName) {
      const current = runtime?.metadata.model ?? '(default)';
      return `Current model: ${current}\nUsage: /model <model-name> - switch model`;
    }

    if (!runtime) {
      return 'No active runtime. Attach or create one first.';
    }

    context.runtimeRegistry.update(runtime.id, {
      metadata: {
        ...runtime.metadata,
        model: modelName,
      },
    });
    return `Model set to: ${modelName}`;
  },
};
