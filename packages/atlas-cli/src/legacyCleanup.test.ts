import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('legacy beam cleanup', () => {
  it('exports the external runtime adapter instead of beam-specific naming', async () => {
    const runtimeExports = await import('../../atlas-gateway/src/runtime/index.js');

    expect(runtimeExports).toHaveProperty('ExternalRuntimeAdapter');
    expect(runtimeExports).not.toHaveProperty('BeamRuntimeAdapter');
  });

  it('does not expose the legacy beam binary in atlas-cli package metadata', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf-8'),
    ) as { bin?: Record<string, string> };

    expect(packageJson.bin).not.toHaveProperty('beam');
  });

  it('exposes codelink-runtime while keeping atlas-runtime as a compatibility alias', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf-8'),
    ) as { bin?: Record<string, string> };

    expect(packageJson.bin).toHaveProperty('codelink', 'dist/index.js');
    expect(packageJson.bin).toHaveProperty('atlas', 'dist/index.js');
    expect(packageJson.bin).toHaveProperty('codelink-runtime', 'dist/runtime.js');
    expect(packageJson.bin).toHaveProperty('atlas-runtime', 'dist/runtime.js');
  });

  it('uses codelink-* workspace package names for active packages', async () => {
    const packageFiles = [
      ['../package.json', 'codelink-cli'],
      ['../../atlas-agent/package.json', 'codelink-agent'],
      ['../../atlas-gateway/package.json', 'codelink-gateway'],
      ['../../atlas-wire/package.json', 'codelink-wire'],
      ['../../atlas-app-logs/package.json', 'codelink-app-logs'],
    ] as const;

    for (const [relativePath, expectedName] of packageFiles) {
      const packageJson = JSON.parse(
        await readFile(new URL(relativePath, import.meta.url), 'utf-8'),
      ) as { name?: string };
      expect(packageJson.name).toBe(expectedName);
    }
  });

  it('removes the old top-level beam bridging endpoints and parked session store', async () => {
    const [webUiServer, legacyEngine] = await Promise.all([
      readFile(new URL('../../../src/webui/server.ts', import.meta.url), 'utf-8'),
      readFile(new URL('../../../src/core/engine.ts', import.meta.url), 'utf-8'),
    ]);

    expect(webUiServer).not.toContain('/api/beam');
    expect(webUiServer).not.toContain('parkedSessions');
    expect(legacyEngine).not.toContain('ParkedSessionStore');
    expect(legacyEngine).not.toContain('resumeSession(');
  });

  it('removes the retired top-level command and session implementation files', async () => {
    const retiredFiles = [
      '../../../src/core/command/builtins.ts',
      '../../../src/core/command/builtins.test.ts',
      '../../../src/core/command/index.ts',
      '../../../src/core/command/registry.ts',
      '../../../src/core/command/registry.test.ts',
      '../../../src/core/command/workspace.test.ts',
      '../../../src/core/session/index.ts',
      '../../../src/core/session/manager.ts',
      '../../../src/core/session/normalize.ts',
      '../../../src/core/session/normalize.test.ts',
      '../../../src/core/session/parked.ts',
      '../../../src/core/session/parked.test.ts',
      '../../../src/core/session/queue.ts',
      '../../../src/core/session/queue.test.ts',
      '../../../src/core/session/state.ts',
    ];

    for (const relativePath of retiredFiles) {
      await expect(access(new URL(relativePath, import.meta.url), constants.F_OK)).rejects.toThrow();
    }
  });
});
