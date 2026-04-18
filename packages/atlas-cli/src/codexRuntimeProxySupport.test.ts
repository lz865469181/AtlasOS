import { afterEach, describe, expect, it } from 'vitest';
import { buildLocalCodexRuntimeProxyLaunch } from './codexRuntimeProxySupport.js';

describe('codexRuntimeProxySupport', () => {
  const originalApprovalPolicy = process.env.CODEX_APPROVAL_POLICY;

  afterEach(() => {
    if (originalApprovalPolicy === undefined) {
      delete process.env.CODEX_APPROVAL_POLICY;
    } else {
      process.env.CODEX_APPROVAL_POLICY = originalApprovalPolicy;
    }
  });

  it('does not force an approval policy when none is configured', () => {
    delete process.env.CODEX_APPROVAL_POLICY;

    const launch = buildLocalCodexRuntimeProxyLaunch(import.meta.url);

    expect(launch.env).toEqual({});
    expect(launch.commandString).not.toContain('CODEX_APPROVAL_POLICY=');
  });

  it('propagates an explicit approval policy override into the proxy launch command', () => {
    process.env.CODEX_APPROVAL_POLICY = 'untrusted';

    const launch = buildLocalCodexRuntimeProxyLaunch(import.meta.url);

    expect(launch.env).toEqual({ CODEX_APPROVAL_POLICY: 'untrusted' });
    expect(launch.commandString).toContain('CODEX_APPROVAL_POLICY=untrusted');
  });
});
