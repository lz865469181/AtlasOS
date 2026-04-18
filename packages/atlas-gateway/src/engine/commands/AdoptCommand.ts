import type { Command, CommandContext } from '../CommandRegistry.js';
import { formatTmuxCommandError } from '../../runtime/TmuxDependency.js';

function parseAdoptArgs(
  args: string,
  defaultProvider?: string,
): { provider: 'claude' | 'codex'; sessionName: string; displayName?: string } | null {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  let provider: 'claude' | 'codex' = defaultProvider === 'codex' ? 'codex' : 'claude';
  const positional: string[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '--provider' || token === '-p') {
      const next = tokens[i + 1];
      if (next === 'claude' || next === 'codex') {
        provider = next;
        i += 1;
        continue;
      }
      return null;
    }
    positional.push(token);
  }

  const [sessionName, ...displayNameParts] = positional;
  if (!sessionName) {
    return null;
  }

  return {
    provider,
    sessionName,
    displayName: displayNameParts.join(' ') || undefined,
  };
}

export const AdoptCommand: Command = {
  name: 'adopt',
  description: 'Adopt an existing local tmux session and attach this thread to it.',
  async execute(args: string, context: CommandContext): Promise<string> {
    if (!context.localRuntimeManager) {
      return 'Local tmux session adoption is unavailable on this deployment.';
    }
    if (!context.localRuntimeManager.supportsTmuxSessions) {
      return 'Local tmux session adoption is unavailable on this host.';
    }

    const parsed = parseAdoptArgs(args, context.defaultAgentId);
    if (!parsed) {
      return 'Usage: /adopt [--provider claude|codex] <tmux-session> [name]';
    }

    let adopted;
    try {
      adopted = await context.localRuntimeManager.adoptTmuxRuntime({
        provider: parsed.provider,
        sessionName: parsed.sessionName,
        displayName: parsed.displayName,
        binding: context.binding,
      });
    } catch (error) {
      const tmuxBin =
        process.env.CODELINK_TMUX_BIN
        ?? process.env.ATLAS_TMUX_BIN
        ?? process.env.TMUX_BIN
        ?? 'tmux';
      return formatTmuxCommandError('adopt a tmux session', error, tmuxBin);
    }

    context.bindingStore.attach(context.binding.bindingId, adopted.runtime.id);
    context.bindingStore.setActive(context.binding.bindingId, adopted.runtime.id);

    const label = adopted.runtime.displayName ?? adopted.runtime.id.slice(0, 8);
    if (adopted.reused) {
      return [
        `Attached existing tmux runtime: ${label} [${adopted.runtime.provider}/${adopted.runtime.transport}]`,
        'This thread is now attached to the existing tmux runtime.',
      ].join('\n');
    }

    return [
      `Adopted tmux runtime: ${label} [${adopted.runtime.provider}/${adopted.runtime.transport}]`,
      `Local attach: tmux attach -t ${adopted.sessionName}`,
      'This thread is now attached to the adopted tmux runtime.',
    ].join('\n');
  },
};
