import type { Command, CommandContext } from '../CommandRegistry.js';

export const ModelCommand: Command = {
  name: 'model',
  description: 'Switch the AI model for the current session.',
  async execute(args: string, context: CommandContext): Promise<string> {
    const modelName = args.trim();
    const session = context.sessionManager.get(context.chatId);

    if (!modelName) {
      const current = session?.model ?? '(default)';
      return `Current model: ${current}\nUsage: /model <model-name> — switch model`;
    }

    if (!session) {
      return 'No active session. Send a message first.';
    }

    context.sessionManager.setModel(context.chatId, modelName);
    return `Model set to: ${modelName}`;
  },
};
