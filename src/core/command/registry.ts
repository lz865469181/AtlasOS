import { log } from "../logger.js";

export interface CommandContext {
  args: string;
  userID: string;
  chatID: string;
  chatType: "p2p" | "group";
  platform: string;
  reply: (text: string) => Promise<void>;
  replyCard: (cardJson: string) => Promise<void>;
}

export type CommandHandler = (ctx: CommandContext) => Promise<void>;

export interface CommandDef {
  name: string;
  description: string;
  handler: CommandHandler;
  aliases?: string[];
  adminOnly?: boolean;
}

export interface CustomCommand {
  name: string;
  description: string;
  prompt: string;
  exec?: string;
}

export class CommandRegistry {
  private commands = new Map<string, CommandDef>();
  private customs = new Map<string, CustomCommand>();

  register(cmd: CommandDef): void {
    this.commands.set(cmd.name, cmd);
    if (cmd.aliases) {
      for (const alias of cmd.aliases) {
        this.commands.set(alias, cmd);
      }
    }
  }

  registerCustom(cmd: CustomCommand): void {
    this.customs.set(cmd.name, cmd);
  }

  resolve(name: string): CommandDef | CustomCommand | undefined {
    const exact = this.commands.get(name) ?? this.customs.get(name);
    if (exact) return exact;

    const matches = [...this.commands.values(), ...this.customs.values()]
      .filter((c) => c.name.startsWith(name));
    if (matches.length === 1) return matches[0];
    return undefined;
  }

  listAll(): (CommandDef | CustomCommand)[] {
    const seen = new Set<string>();
    const result: (CommandDef | CustomCommand)[] = [];
    for (const cmd of this.commands.values()) {
      if (!seen.has(cmd.name)) {
        seen.add(cmd.name);
        result.push(cmd);
      }
    }
    for (const cmd of this.customs.values()) {
      if (!seen.has(cmd.name)) {
        seen.add(cmd.name);
        result.push(cmd);
      }
    }
    return result;
  }
}

export function expandPrompt(template: string, args: string): string {
  const parts = args.split(/\s+/).filter(Boolean);
  let result = template;
  result = result.replace(/\{\{(\d+)\}\}/g, (_, n) => parts[Number(n) - 1] ?? "");
  result = result.replace(/\{\{(\d+)\*\}\}/g, (_, n) => parts.slice(Number(n) - 1).join(" "));
  result = result.replace(/\{\{args\}\}/g, args);
  return result.trim();
}
