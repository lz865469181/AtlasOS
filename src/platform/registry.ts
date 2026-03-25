import type { PlatformAdapter } from "./types.js";

const adapters = new Map<string, PlatformAdapter>();

export function registerAdapter(adapter: PlatformAdapter): void {
  adapters.set(adapter.name, adapter);
}

export function getAdapter(name: string): PlatformAdapter | undefined {
  return adapters.get(name);
}

export function allAdapters(): PlatformAdapter[] {
  return [...adapters.values()];
}

// ─── Factory Registry ──────────────────────────────────────────────────────
// Used by Engine for declarative platform creation from config.

export type PlatformFactory = (config: Record<string, unknown>) => PlatformAdapter;

const factories = new Map<string, PlatformFactory>();

export function registerPlatform(name: string, factory: PlatformFactory): void {
  factories.set(name, factory);
}

export function createPlatform(name: string, config: Record<string, unknown>): PlatformAdapter {
  const factory = factories.get(name);
  if (!factory) throw new Error(`Unknown platform: ${name}. Registered: ${[...factories.keys()].join(", ")}`);
  return factory(config);
}

export function registeredPlatforms(): string[] {
  return [...factories.keys()];
}
