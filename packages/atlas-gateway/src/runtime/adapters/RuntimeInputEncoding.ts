import type { RuntimeSession } from '../RuntimeModels.js';

function usesJsonlInputProtocol(runtime: RuntimeSession): boolean {
  return runtime.metadata.inputProtocol === 'codelink-jsonl-v1';
}

export function encodeRuntimePrompt(runtime: RuntimeSession, text: string): string {
  if (usesJsonlInputProtocol(runtime)) {
    return JSON.stringify({
      type: 'prompt',
      text,
    });
  }

  return text;
}

export function encodeRuntimePermissionResponse(
  runtime: RuntimeSession,
  requestId: string,
  approved: boolean,
): string | null {
  if (!usesJsonlInputProtocol(runtime)) {
    return null;
  }

  return JSON.stringify({
    type: 'permission-response',
    requestId,
    approved,
  });
}
