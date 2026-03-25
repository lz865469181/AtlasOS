export function log(level: string, msg: string, meta?: Record<string, unknown>): void {
  const entry = { time: new Date().toISOString(), level, msg, ...meta };
  console.log(JSON.stringify(entry));
}

export function redactToken(token: string): string {
  if (token.length <= 8) return "***";
  return token.slice(0, 4) + "..." + token.slice(-4);
}
