import type { Command, CommandContext } from '../CommandRegistry.js';
import { formatTmuxCommandError } from '../../runtime/TmuxDependency.js';

function parseTmuxArgs(args: string): { provider: 'claude' | 'codex'; name: string } | null {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  let provider: 'claude' | 'codex' = 'claude';
  const nameTokens: string[] = [];

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

    if ((token === 'claude' || token === 'codex') && nameTokens.length === 0 && i === 0) {
      provider = token;
      continue;
    }

    nameTokens.push(token);
  }

  return {
    provider,
    name: nameTokens.join(' '),
  };
}

export const TmuxCommand: Command = {
  name: 'tmux',
  description: 'Start a local tmux-backed Claude or Codex runtime and attach this thread to it.',
  async execute(args: string, context: CommandContext): Promise<string> {
    if (!context.localRuntimeManager) {
      return 'Local tmux runtime creation is unavailable on this deployment.';
    }

    const parsed = parseTmuxArgs(args);
    if (!parsed) {
      return 'Usage: /tmux [--provider claude|codex] [name]';
    }

    let started;
    try {
      started = await context.localRuntimeManager.startTmuxRuntime({
        provider: parsed.provider,
        name: parsed.name,
        binding: context.binding,
      });
    } catch (error) {
      const tmuxBin =
        process.env.CODELINK_TMUX_BIN
        ?? process.env.ATLAS_TMUX_BIN
        ?? process.env.TMUX_BIN
        ?? 'tmux';
      return formatTmuxCommandError('start a tmux runtime', error, tmuxBin);
    }

    context.bindingStore.attach(context.binding.bindingId, started.runtime.id);
    context.bindingStore.setActive(context.binding.bindingId, started.runtime.id);

    const label = started.runtime.displayName ?? started.runtime.id.slice(0, 8);
    return [
      `Started tmux runtime: ${label} [${started.runtime.provider}/${started.runtime.transport}]`,
      `Local attach: tmux attach -t ${started.sessionName}`,
      'This thread is now attached to the new tmux runtime.',
    ].join('\n');
  },
};
