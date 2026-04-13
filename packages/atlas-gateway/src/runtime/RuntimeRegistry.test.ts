import { describe, expect, it } from 'vitest';
import { RuntimeRegistryImpl } from './RuntimeRegistry.js';

describe('RuntimeRegistryImpl', () => {
  it('creates an atlas-managed runtime', async () => {
    const registry = new RuntimeRegistryImpl();

    const runtime = await registry.create({
      id: 'claude-sdk',
      provider: 'claude',
      transport: 'sdk',
      displayName: 'Claude SDK',
      defaultCapabilities: {
        streaming: true,
        permissionCards: true,
        fileAccess: false,
        imageInput: false,
        terminalOutput: false,
        patchEvents: false,
      },
    }, { displayName: 'main' });

    expect(runtime.source).toBe('atlas-managed');
    expect(registry.get(runtime.id)).toEqual(runtime);
  });
});
