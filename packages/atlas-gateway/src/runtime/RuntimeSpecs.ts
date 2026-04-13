import type { AgentSpec, RuntimeCapabilities, RuntimeSession } from './RuntimeModels.js';

const DEFAULT_CAPABILITIES: RuntimeCapabilities = {
  streaming: true,
  permissionCards: true,
  fileAccess: false,
  imageInput: false,
  terminalOutput: false,
  patchEvents: false,
};

function providerFromAgent(agentId: string): RuntimeSession['provider'] {
  if (agentId.startsWith('codex')) return 'codex';
  if (agentId.startsWith('gemini')) return 'gemini';
  if (agentId.startsWith('claude')) return 'claude';
  return 'custom';
}

function transportFromAgent(agentId: string): RuntimeSession['transport'] {
  if (agentId.endsWith('-acp')) return 'acp';
  return 'sdk';
}

export function defaultRuntimeSpecForAgent(agentId: string): AgentSpec {
  return {
    id: agentId,
    provider: providerFromAgent(agentId),
    transport: transportFromAgent(agentId),
    displayName: agentId,
    defaultCapabilities: { ...DEFAULT_CAPABILITIES },
  };
}
