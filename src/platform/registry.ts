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
