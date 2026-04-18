export function resolveLocalRuntimeTransport(platform: NodeJS.Platform = process.platform): 'tmux' | 'pty' {
  return platform === 'win32' ? 'pty' : 'tmux';
}

export function supportsReusableTmuxSessions(platform: NodeJS.Platform = process.platform): boolean {
  return resolveLocalRuntimeTransport(platform) === 'tmux';
}
