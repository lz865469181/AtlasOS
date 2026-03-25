import type { PlatformSender } from "../platform/types.js";
import { log } from "./logger.js";

export interface RelayBinding {
  chatID: string;
  agents: Record<string, string>;
}

export type RelayMessageHandler = (
  fromAgent: string, toAgent: string, message: string, chatID: string,
) => Promise<string>;

export class RelayManager {
  private bindings = new Map<string, RelayBinding>();
  private messageHandler?: RelayMessageHandler;
  private timeoutMs: number;

  constructor(opts?: { timeoutMs?: number }) {
    this.timeoutMs = opts?.timeoutMs ?? 120_000;
  }

  setMessageHandler(handler: RelayMessageHandler): void { this.messageHandler = handler; }

  bind(chatID: string, agents: Record<string, string>): void {
    this.bindings.set(chatID, { chatID, agents });
    log("info", "Relay binding created", { chatID, agents: Object.keys(agents) });
  }

  unbind(chatID: string): void { this.bindings.delete(chatID); }
  isBound(chatID: string): boolean { return this.bindings.has(chatID); }
  getBinding(chatID: string): RelayBinding | undefined { return this.bindings.get(chatID); }

  async send(
    fromAgent: string, toAgent: string, message: string, chatID: string, sender?: PlatformSender,
  ): Promise<string> {
    if (!this.messageHandler) throw new Error("No relay message handler configured");
    const binding = this.bindings.get(chatID);
    if (!binding) throw new Error(`No relay binding for chat ${chatID}`);
    if (!binding.agents[toAgent]) throw new Error(`Agent "${toAgent}" is not bound to chat ${chatID}`);

    if (sender) {
      const fromName = binding.agents[fromAgent] ?? fromAgent;
      const toName = binding.agents[toAgent] ?? toAgent;
      await sender.sendText(chatID, `[${fromName} → ${toName}] ${message.slice(0, 200)}`);
    }

    log("info", "Relay message", { from: fromAgent, to: toAgent, chatID });

    const result = await Promise.race([
      this.messageHandler(fromAgent, toAgent, message, chatID),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("Relay timeout")), this.timeoutMs),
      ),
    ]);

    if (sender) {
      const toName = binding.agents[toAgent] ?? toAgent;
      await sender.sendMarkdown(chatID, `**[${toName}]**\n\n${result.slice(0, 2000)}`);
    }
    return result;
  }

  listBindings(): RelayBinding[] { return [...this.bindings.values()]; }
}
