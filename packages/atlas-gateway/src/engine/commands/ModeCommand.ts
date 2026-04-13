import type { Command, CommandContext } from '../CommandRegistry.js';

const VALID_MODES = ['auto', 'confirm', 'deny'];

export const ModeCommand: Command = {
  name: 'mode',
  description: 'Set the permission mode (auto / confirm / deny).',
  async execute(args: string, context: CommandContext): Promise<string> {
    const mode = args.trim().toLowerCase();
    const runtime = context.binding.activeRuntimeId
      ? context.runtimeRegistry.get(context.binding.activeRuntimeId)
      : undefined;

    if (!mode) {
      const current = runtime?.metadata.permissionMode ?? '(unknown)';
      return `Current mode: ${current}\nUsage: /mode <${VALID_MODES.join('|')}> - set permission mode`;
    }

    if (!VALID_MODES.includes(mode)) {
      return `Invalid mode: ${mode}. Valid modes: ${VALID_MODES.join(', ')}`;
    }

    if (!runtime) {
      return 'No active runtime. Attach or create one first.';
    }

    context.runtimeRegistry.update(runtime.id, {
      metadata: {
        ...runtime.metadata,
        permissionMode: mode,
      },
    });
    return `Permission mode set to: ${mode}`;
  },
};
