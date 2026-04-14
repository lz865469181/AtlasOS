import type { CommandContext } from '../CommandRegistry.js';
import type { RuntimeSession } from '../../runtime/RuntimeModels.js';

export function resolveAttachedRuntime(prefix: string, context: CommandContext): {
  target?: RuntimeSession;
  error?: string;
} {
  const query = prefix.trim();
  if (!query) {
    return { error: 'missing target' };
  }

  if (context.binding.attachedRuntimeIds.length === 0) {
    return { error: 'No runtimes attached to this thread. Use /attach <id> first.' };
  }

  const attachedDetails = context.binding.attachedRuntimeIds
    .map(id => context.runtimeRegistry.get(id))
    .filter((runtime): runtime is NonNullable<typeof runtime> => runtime != null);

  const num = parseInt(query, 10);
  if (!Number.isNaN(num) && String(num) === query && num >= 1 && num <= attachedDetails.length) {
    return { target: attachedDetails[num - 1] };
  }

  const lower = query.toLowerCase();
  let matched = attachedDetails.filter(runtime => runtime.displayName?.toLowerCase() === lower);
  if (matched.length === 0) {
    matched = attachedDetails.filter(runtime => runtime.displayName?.toLowerCase().startsWith(lower));
  }
  if (matched.length === 0) {
    matched = attachedDetails.filter(runtime => runtime.id.toLowerCase().startsWith(lower));
  }

  if (matched.length === 0) {
    return {
      error: `No attached runtime matches: ${query}. Use /sessions to see attached runtimes.`,
    };
  }

  if (matched.length > 1) {
    return {
      error: `Ambiguous: ${query} matches ${matched.length} runtimes. Be more specific.`,
    };
  }

  return { target: matched[0] };
}
