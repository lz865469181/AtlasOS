import type { CardModel } from '../cards/CardModel.js';
import type { ChannelSender } from '../channel/ChannelSender.js';
import type { ConversationBinding } from '../runtime/RuntimeModels.js';
import type { BindingStoreImpl } from '../runtime/BindingStore.js';
import type { RuntimeRegistryImpl } from '../runtime/RuntimeRegistry.js';
import type { RuntimeBridgeImpl } from '../runtime/RuntimeBridge.js';

export interface CommandContext {
  binding: ConversationBinding;
  runtimeRegistry: RuntimeRegistryImpl;
  bindingStore: BindingStoreImpl;
  runtimeBridge: RuntimeBridgeImpl;
  defaultAgentId?: string;
  defaultPermissionMode?: string;
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

import { CancelCommand } from './commands/CancelCommand.js';
import { StatusCommand } from './commands/StatusCommand.js';
import { AgentCommand } from './commands/AgentCommand.js';
import { ModelCommand } from './commands/ModelCommand.js';
import { ModeCommand } from './commands/ModeCommand.js';
import { NewCommand } from './commands/NewCommand.js';
import { ListCommand } from './commands/ListCommand.js';
import { AttachCommand } from './commands/AttachCommand.js';
import { FocusCommand } from './commands/FocusCommand.js';
import { WatchCommand } from './commands/WatchCommand.js';
import { UnwatchCommand } from './commands/UnwatchCommand.js';
import { DetachCommand } from './commands/DetachCommand.js';
import { SessionsCommand } from './commands/SessionsCommand.js';
import { DestroyCommand } from './commands/DestroyCommand.js';

const helpCommand: Command = {
  name: 'help',
  aliases: ['h', '?'],
  description: 'Show available commands.',
  execute: async () =>
    'Available commands: /agent, /model, /mode, /cancel, /status, /new, /destroy, /list, /attach, /focus, /watch, /unwatch, /detach, /sessions, /help',
};

const builtinCommands: Command[] = [
  AgentCommand,
  ModelCommand,
  ModeCommand,
  CancelCommand,
  StatusCommand,
  NewCommand,
  ListCommand,
  AttachCommand,
  FocusCommand,
  WatchCommand,
  UnwatchCommand,
  DetachCommand,
  SessionsCommand,
  DestroyCommand,
  helpCommand,
];

export class CommandRegistryImpl implements CommandRegistry {
  private commands = new Map<string, Command>();
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

    const withoutSlash = trimmed.slice(1);
    const spaceIdx = withoutSlash.indexOf(' ');
    const rawName = (spaceIdx === -1 ? withoutSlash : withoutSlash.slice(0, spaceIdx)).toLowerCase();
    const args = spaceIdx === -1 ? '' : withoutSlash.slice(spaceIdx + 1).trim();

    if (rawName === '') {
      return null;
    }

    const exact = this.commands.get(rawName);
    if (exact) {
      return { command: exact, args };
    }

    const aliasTarget = this.aliases.get(rawName);
    if (aliasTarget) {
      const cmd = this.commands.get(aliasTarget);
      if (cmd) {
        return { command: cmd, args };
      }
    }

    const nameMatches: Command[] = [];
    for (const [name, cmd] of this.commands) {
      if (name.startsWith(rawName)) {
        nameMatches.push(cmd);
      }
    }

    const aliasMatches: Command[] = [];
    for (const [alias, targetName] of this.aliases) {
      if (alias.startsWith(rawName)) {
        const cmd = this.commands.get(targetName);
        if (cmd && !nameMatches.includes(cmd) && !aliasMatches.includes(cmd)) {
          aliasMatches.push(cmd);
        }
      }
    }

    const unique = [...new Set([...nameMatches, ...aliasMatches])];
    if (unique.length === 1) {
      return { command: unique[0], args };
    }

    return null;
  }

  listCommands(): Command[] {
    return [...this.commands.values()];
  }
}
