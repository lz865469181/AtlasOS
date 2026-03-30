import type { CardModel } from '../cards/CardModel.js';
import type { ChannelSender } from '../channel/ChannelSender.js';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface SessionManagerLike {
  get(chatId: string): { agentId: string; model?: string; permissionMode: string } | undefined;
  switchAgent(chatId: string, agentId: string): Promise<unknown>;
  setModel(chatId: string, model: string): void;
  setPermissionMode(chatId: string, mode: string): void;
  destroy(chatId: string): Promise<void>;
  listActive(): Array<{ sessionId: string; chatId: string; agentId: string }>;
}

export interface CommandContext {
  chatId: string;
  userId: string;
  sessionManager: SessionManagerLike;
  sender: ChannelSender;
}

export interface Command {
  name: string;
  aliases?: string[];
  description: string;
  execute(args: string, context: CommandContext): Promise<string | CardModel>;
}

export interface CommandRegistry {
  register(command: Command): void;
  resolve(input: string): { command: Command; args: string } | null;
  listCommands(): Command[];
}

// ── Built-in commands ───────────────────────────────────────────────────────

const builtinCommands: Command[] = [
  {
    name: 'agent',
    description: 'Switch to a different agent or list available agents.',
    execute: async () => 'Usage: /agent <agent-id> — switch agent',
  },
  {
    name: 'model',
    description: 'Switch the AI model for the current session.',
    execute: async () => 'Usage: /model <model-name> — switch model',
  },
  {
    name: 'mode',
    description: 'Set the permission mode (auto / confirm / deny).',
    execute: async () => 'Usage: /mode <auto|confirm|deny> — set permission mode',
  },
  {
    name: 'cancel',
    description: 'Cancel the currently running agent task.',
    execute: async () => 'Task cancelled.',
  },
  {
    name: 'status',
    description: 'Show the current session status.',
    execute: async () => 'No active session.',
  },
  {
    name: 'help',
    aliases: ['h', '?'],
    description: 'Show available commands.',
    execute: async () => 'Available commands: /agent, /model, /mode, /cancel, /status, /help',
  },
];

// ── Implementation ──────────────────────────────────────────────────────────

export class CommandRegistryImpl implements CommandRegistry {
  /** name (lowercase) -> Command */
  private commands = new Map<string, Command>();
  /** alias (lowercase) -> command name (lowercase) */
  private aliases = new Map<string, string>();

  constructor(options?: { registerBuiltins?: boolean }) {
    const registerBuiltins = options?.registerBuiltins ?? true;
    if (registerBuiltins) {
      for (const cmd of builtinCommands) {
        this.register(cmd);
      }
    }
  }

  register(command: Command): void {
    const key = command.name.toLowerCase();
    this.commands.set(key, command);

    if (command.aliases) {
      for (const alias of command.aliases) {
        this.aliases.set(alias.toLowerCase(), key);
      }
    }
  }

  resolve(input: string): { command: Command; args: string } | null {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) {
      return null;
    }

    // Extract the command name (first word after /) and the rest as args
    const withoutSlash = trimmed.slice(1);
    const spaceIdx = withoutSlash.indexOf(' ');
    const rawName = (spaceIdx === -1 ? withoutSlash : withoutSlash.slice(0, spaceIdx)).toLowerCase();
    const args = spaceIdx === -1 ? '' : withoutSlash.slice(spaceIdx + 1).trim();

    if (rawName === '') {
      return null;
    }

    // 1. Exact match by name
    const exact = this.commands.get(rawName);
    if (exact) {
      return { command: exact, args };
    }

    // 2. Exact match by alias
    const aliasTarget = this.aliases.get(rawName);
    if (aliasTarget) {
      const cmd = this.commands.get(aliasTarget);
      if (cmd) {
        return { command: cmd, args };
      }
    }

    // 3. Prefix match against names
    const nameMatches: Command[] = [];
    for (const [name, cmd] of this.commands) {
      if (name.startsWith(rawName)) {
        nameMatches.push(cmd);
      }
    }

    // Also check alias prefixes
    const aliasMatches: Command[] = [];
    for (const [alias, targetName] of this.aliases) {
      if (alias.startsWith(rawName)) {
        const cmd = this.commands.get(targetName);
        if (cmd && !nameMatches.includes(cmd) && !aliasMatches.includes(cmd)) {
          aliasMatches.push(cmd);
        }
      }
    }

    const allMatches = [...nameMatches, ...aliasMatches];

    // Deduplicate: a command matched by both name-prefix and alias-prefix counts once
    const unique = [...new Set(allMatches)];

    if (unique.length === 1) {
      return { command: unique[0], args };
    }

    // Ambiguous or no match
    return null;
  }

  listCommands(): Command[] {
    return [...this.commands.values()];
  }
}
