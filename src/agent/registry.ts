import type { Agent } from "./types.js";

export type AgentFactory = (options: Record<string, unknown>) => Agent;

const factories = new Map<string, AgentFactory>();

export function registerAgent(name: string, factory: AgentFactory): void {
  factories.set(name, factory);
}

export function createAgent(name: string, options: Record<string, unknown> = {}): Agent {
  const factory = factories.get(name);
  if (!factory) {
    throw new Error(`Unknown agent: "${name}". Available: ${[...factories.keys()].join(", ")}`);
  }
  return factory(options);
}

export function registeredAgents(): string[] {
  return [...factories.keys()];
}
