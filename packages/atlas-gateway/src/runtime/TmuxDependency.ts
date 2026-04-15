function normalizeBinaryName(tmuxBin: string): string {
  return tmuxBin.trim().split(/[\\/]/).at(-1)?.toLowerCase() || 'tmux';
}

export function isTmuxMissingError(error: unknown, tmuxBin = 'tmux'): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = 'code' in error ? String((error as Error & { code?: unknown }).code ?? '') : '';
  const path = 'path' in error ? String((error as Error & { path?: unknown }).path ?? '') : '';
  const message = error.message.toLowerCase();
  const binary = normalizeBinaryName(tmuxBin);

  if (code === 'ENOENT') {
    if (!path) {
      return true;
    }
    return path.toLowerCase().includes(binary) || path.toLowerCase().includes(tmuxBin.toLowerCase());
  }

  return message.includes(`spawn ${binary} enoent`)
    || message.includes(`${binary}: not found`)
    || message.includes(`'${binary}' is not recognized`);
}

export function buildTmuxInstallHint(tmuxBin = 'tmux'): string {
  return [
    `tmux is not installed or not reachable as \`${tmuxBin}\`.`,
    'Install tmux, or point `CODELINK_TMUX_BIN` / `ATLAS_TMUX_BIN` / `TMUX_BIN` to the tmux binary path.',
    'Windows (PowerShell): `winget install -e --id marlocarlo.psmux`',
    'Windows note: restart the shell so the `tmux` alias is available, or set `CODELINK_TMUX_BIN` to the installed `psmux.exe` path directly.',
    'macOS: `brew install tmux`',
    'Ubuntu/Debian: `sudo apt-get install tmux`',
    'Fedora/RHEL: `sudo dnf install tmux`',
  ].join('\n');
}

export function formatTmuxCommandError(action: string, error: unknown, tmuxBin = 'tmux'): string {
  if (isTmuxMissingError(error, tmuxBin)) {
    return [
      `Unable to ${action}.`,
      buildTmuxInstallHint(tmuxBin),
    ].join('\n');
  }

  const detail = error instanceof Error ? error.message : String(error);
  return `Failed to ${action}: ${detail}`;
}
