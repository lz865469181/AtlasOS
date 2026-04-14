import type { Command, CommandContext } from '../CommandRegistry.js';

export const StatusCommand: Command = {
  name: 'status',
  description: 'Show the current runtime status.',
  async execute(_args: string, context: CommandContext): Promise<string> {
    if (!context.binding.activeRuntimeId) {
      return 'No active runtime.';
    }

    const runtime = context.runtimeRegistry.get(context.binding.activeRuntimeId);
    if (!runtime) {
      return 'Active runtime is missing.';
    }
    const watchRuntimes = context.binding.watchRuntimeIds
      .map((runtimeId) => context.runtimeRegistry.get(runtimeId))
      .filter((entry): entry is NonNullable<typeof entry> => entry != null);

    const uptime = Math.floor((Date.now() - runtime.createdAt) / 1000);
    const mins = Math.floor(uptime / 60);
    const secs = uptime % 60;
    const label = runtime.displayName ?? runtime.id.slice(0, 8);

    const lines = [
      `Runtime: ${label} [${runtime.provider}/${runtime.transport}]`,
      `Provider: ${runtime.provider}`,
      `Transport: ${runtime.transport}`,
      `Model: ${runtime.metadata.model ?? '(default)'}`,
      `Mode: ${runtime.metadata.permissionMode ?? '(default)'}`,
      `Uptime: ${mins}m ${secs}s`,
      `Runtime ID: ${runtime.id}`,
    ];

    if (runtime.resumeHandle) {
      lines.push(`Resume: ${runtime.resumeHandle.kind} ${runtime.resumeHandle.value}`);
    }

    for (const watchRuntime of watchRuntimes) {
      const watchLabel = watchRuntime.displayName ?? watchRuntime.id.slice(0, 8);
      lines.push(`Watching: ${watchLabel} [${watchRuntime.provider}/${watchRuntime.transport}] - ${watchRuntime.status}`);
    }

    return lines.join('\n');
  },
};
