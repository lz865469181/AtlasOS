import type { Command, CommandContext } from '../CommandRegistry.js';

const VALID_MODES = ['auto', 'confirm', 'deny'];

export const ModeCommand: Command = {
  name: 'mode',
  description: 'Set the permission mode (auto / confirm / deny).',
  async execute(args: string, context: CommandContext): Promise<string> {
    const mode = args.trim().toLowerCase();
    const session = context.sessionManager.get(context.chatId);

    if (!mode) {
      const current = session?.permissionMode ?? '(unknown)';
      return `Current mode: ${current}\nUsage: /mode <${VALID_MODES.join('|')}> — set permission mode`;
    }

    if (!VALID_MODES.includes(mode)) {
      return `Invalid mode: ${mode}. Valid modes: ${VALID_MODES.join(', ')}`;
    }

    if (!session) {
      return 'No active session. Send a message first.';
    }

    context.sessionManager.setPermissionMode(context.chatId, mode);
    return `Permission mode set to: ${mode}`;
  },
};
