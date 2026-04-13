import type { Server } from 'node:http';

export interface WebUIDeps {}

export function startWebUI(_port: number, _deps?: WebUIDeps): Server {
  throw new Error(
    'The top-level WebUI server has been retired. Use the runtime API exposed by packages/atlas-cli (workspace package `codelink-cli`) instead.',
  );
}
