export interface RuntimeRegistrationPayload {
  runtimeId: string;
  source: 'external';
  provider: 'claude' | 'codex';
  transport: 'tmux';
  displayName: string;
  resumeHandle: { kind: 'tmux-session'; value: string };
  capabilities: {
    streaming: true;
    permissionCards: false;
    fileAccess: true;
    imageInput: false;
    terminalOutput: true;
    patchEvents: false;
  };
  metadata: Record<string, string>;
}

export interface LaunchTmuxRuntimeOptions {
  provider: 'claude' | 'codex';
  name: string;
  displayName?: string;
  sessionName?: string;
  cwd: string;
  cliPath: string;
  serverUrl: string;
  commandOverride?: string;
  metadata?: Record<string, string>;
}

export interface AdoptTmuxRuntimeOptions {
  provider: 'claude' | 'codex';
  sessionName: string;
  displayName?: string;
  serverUrl: string;
}

export interface LaunchTmuxRuntimeDeps {
  runCommand: (args: string[]) => Promise<string>;
  registerRuntime: (payload: RuntimeRegistrationPayload) => Promise<void>;
  createRuntimeId?: () => string;
}

export interface RegisteredExternalRuntime {
  id: string;
  provider: 'claude' | 'codex' | string;
  transport?: string;
  displayName?: string;
  resumeHandle?: { kind?: string; value?: string };
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function sanitizeSessionName(name: string): string {
  return name.trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'codelink-runtime';
}

function defaultDisplayName(name: string): string {
  return name.trim() || 'codelink-runtime';
}

function normalizeDiscoveredSessionName(line: string): string {
  const trimmed = line.trim();
  const fallbackMatch = /^([^:]+):\s+\d+\s+windows?\b/i.exec(trimmed);
  if (fallbackMatch) {
    return fallbackMatch[1].trim();
  }
  return trimmed;
}

function buildRuntimeCommand(provider: 'claude' | 'codex', cliPath: string, runtimeId: string): string {
  if (provider === 'claude') {
    return `${shellQuote(cliPath)} --session-id ${shellQuote(runtimeId)}`;
  }
  return shellQuote(cliPath);
}

function buildPayload(opts: {
  runtimeId: string;
  provider: 'claude' | 'codex';
  displayName: string;
  sessionName: string;
  tmuxTarget: string;
  tmuxManaged: 'true' | 'false';
  cwd?: string;
  metadata?: Record<string, string>;
}): RuntimeRegistrationPayload {
  return {
    runtimeId: opts.runtimeId,
    source: 'external',
    provider: opts.provider,
    transport: 'tmux',
    displayName: opts.displayName,
    resumeHandle: { kind: 'tmux-session', value: opts.sessionName },
    capabilities: {
      streaming: true,
      permissionCards: false,
      fileAccess: true,
      imageInput: false,
      terminalOutput: true,
      patchEvents: false,
    },
    metadata: {
      agentId: opts.provider,
      launcher: 'codelink-runtime',
      tmuxManaged: opts.tmuxManaged,
      tmuxSessionName: opts.sessionName,
      tmuxTarget: opts.tmuxTarget,
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      ...(opts.tmuxManaged === 'false' ? { tmuxAdopted: 'true' } : {}),
      ...(opts.metadata ?? {}),
    },
  };
}

export async function discoverTmuxSessions(
  deps: Pick<LaunchTmuxRuntimeDeps, 'runCommand'>,
): Promise<Array<{ sessionName: string }>> {
  const stdout = await deps.runCommand(['list-sessions', '-F', '#{session_name}']);
  return stdout
    .split(/\r?\n/)
    .map(normalizeDiscoveredSessionName)
    .filter(Boolean)
    .map((sessionName) => ({ sessionName }));
}

export function findExistingTmuxRuntime(
  runtimes: RegisteredExternalRuntime[],
  opts: { provider: 'claude' | 'codex'; sessionName: string },
): RegisteredExternalRuntime | null {
  return runtimes.find((runtime) =>
    runtime.provider === opts.provider
    && runtime.transport === 'tmux'
    && runtime.resumeHandle?.kind === 'tmux-session'
    && runtime.resumeHandle.value === opts.sessionName) ?? null;
}

export async function launchTmuxRuntime(
  opts: LaunchTmuxRuntimeOptions,
  deps: LaunchTmuxRuntimeDeps,
): Promise<{ runtimeId: string; displayName: string; sessionName: string; tmuxTarget: string }> {
  const runtimeId = deps.createRuntimeId?.() ?? crypto.randomUUID();
  const displayName = defaultDisplayName((opts.displayName ?? opts.name) || runtimeId.slice(0, 8));
  const sessionBaseName = sanitizeSessionName(opts.sessionName ?? displayName);
  const sessionName = `codelink-${sessionBaseName}`;
  const tmuxTarget = `${sessionName}:0.0`;

  await deps.runCommand([
    'new-session',
    '-d',
    '-s',
    sessionName,
    '-c',
    opts.cwd,
    opts.commandOverride ?? buildRuntimeCommand(opts.provider, opts.cliPath, runtimeId),
  ]);

  await deps.registerRuntime(buildPayload({
    runtimeId,
    provider: opts.provider,
    displayName,
    sessionName,
    tmuxTarget,
    tmuxManaged: 'true',
    cwd: opts.cwd,
    metadata: opts.metadata,
  }));

  return {
    runtimeId,
    displayName,
    sessionName,
    tmuxTarget,
  };
}

export async function adoptTmuxRuntime(
  opts: AdoptTmuxRuntimeOptions,
  deps: LaunchTmuxRuntimeDeps,
): Promise<{ runtimeId: string; displayName: string; sessionName: string; tmuxTarget: string }> {
  const runtimeId = deps.createRuntimeId?.() ?? crypto.randomUUID();
  const sessionName = opts.sessionName.trim();
  const displayName = defaultDisplayName(opts.displayName || sessionName);

  await deps.runCommand(['has-session', '-t', sessionName]);
  const tmuxTargetRaw = await deps.runCommand([
    'display-message',
    '-p',
    '-t',
    sessionName,
    '#{session_name}:#{window_index}.#{pane_index}',
  ]);
  const tmuxTarget = tmuxTargetRaw.trim() || `${sessionName}:0.0`;

  await deps.registerRuntime(buildPayload({
    runtimeId,
    provider: opts.provider,
    displayName,
    sessionName,
    tmuxTarget,
    tmuxManaged: 'false',
  }));

  return {
    runtimeId,
    displayName,
    sessionName,
    tmuxTarget,
  };
}
