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

/**
 * Resolve a runtime by name/ID across all known runtimes (not just attached),
 * preferring attached ones, then falling back to the registry list.
 */
export function resolveRuntimeAny(prefix: string, context: CommandContext): {
  target?: RuntimeSession;
  error?: string;
} {
  const query = prefix.trim();
  if (!query) return { error: 'missing target' };

  const allRuntimes = context.runtimeRegistry.list();
  if (allRuntimes.length === 0) return { error: 'No runtimes registered.' };

  const lower = query.toLowerCase();

  const byDisplay = allRuntimes.filter((r) => r.displayName?.toLowerCase() === lower);
  if (byDisplay.length === 1) return { target: byDisplay[0] };

  const byDisplayPrefix = allRuntimes.filter((r) => r.displayName?.toLowerCase().startsWith(lower));
  if (byDisplayPrefix.length === 1) return { target: byDisplayPrefix[0] };

  const byIdPrefix = allRuntimes.filter((r) => r.id.toLowerCase().startsWith(lower));
  if (byIdPrefix.length === 1) return { target: byIdPrefix[0] };

  if (byDisplay.length + byDisplayPrefix.length + byIdPrefix.length === 0) {
    return { error: `No runtime matches: ${query}. Use /sessions to see runtimes.` };
  }

  return { error: `Ambiguous: ${query} matches multiple runtimes. Be more specific.` };
}
