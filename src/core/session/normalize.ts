import { resolve } from "node:path";
import { realpathSync } from "node:fs";

/**
 * Normalize a workspace path for consistent session key generation.
 * Resolves relative paths, removes trailing slashes, and follows symlinks.
 */
export function normalizeWorkspacePath(inputPath: string): string {
  const resolved = resolve(inputPath);
  try {
    const real = realpathSync(resolved);
    if (real !== inputPath) {
      console.log(`[path] normalized "${inputPath}" → "${real}"`);
    }
    return real;
  } catch {
    if (resolved !== inputPath) {
      console.log(`[path] normalized "${inputPath}" → "${resolved}"`);
    }
    return resolved;
  }
}
