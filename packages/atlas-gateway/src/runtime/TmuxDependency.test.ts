import { describe, expect, it } from 'vitest';
import { buildTmuxInstallHint, isTmuxMissingError } from './TmuxDependency.js';

describe('TmuxDependency', () => {
  it('detects missing tmux binaries from spawn errors', () => {
    const err = Object.assign(new Error('spawn tmux ENOENT'), { code: 'ENOENT' });
    expect(isTmuxMissingError(err, 'tmux')).toBe(true);
  });

  it('builds install guidance with env override hints', () => {
    const message = buildTmuxInstallHint('tmux');

    expect(message).toContain('tmux is not installed or not reachable');
    expect(message).toContain('brew install tmux');
    expect(message).toContain('sudo apt-get install tmux');
    expect(message).toContain('Windows (PowerShell): `winget install -e --id marlocarlo.psmux`');
    expect(message).toContain('restart the shell so the `tmux` alias is available');
    expect(message).toContain('CODELINK_TMUX_BIN');
  });
});
