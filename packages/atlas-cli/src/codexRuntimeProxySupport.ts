import { fileURLToPath } from 'node:url';

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:\\-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export function resolveLocalCodexRuntimeProxyPath(importMetaUrl: string): string {
  return fileURLToPath(new URL('./localCodexRuntimeProxy.js', importMetaUrl));
}

export function buildLocalCodexRuntimeProxyLaunch(importMetaUrl: string): {
  command: string;
  args: string[];
  commandString: string;
  env: Record<string, string>;
} {
  const command = process.execPath;
  const scriptPath = resolveLocalCodexRuntimeProxyPath(importMetaUrl);
  const approvalPolicy = process.env.CODEX_APPROVAL_POLICY;
  const env: Record<string, string> = approvalPolicy
    ? { CODEX_APPROVAL_POLICY: approvalPolicy }
    : {};
  return {
    command,
    args: [scriptPath],
    commandString: `${env.CODEX_APPROVAL_POLICY ? `CODEX_APPROVAL_POLICY=${shellQuote(env.CODEX_APPROVAL_POLICY)} ` : ''}${shellQuote(command)} ${shellQuote(scriptPath)}`,
    env,
  };
}
