export interface EngineConfig {
  readonly retired?: true;
}

export class Engine {
  constructor(_agent: unknown, _config: EngineConfig) {
    throw new Error(
      'The top-level src engine has been retired. Use packages/atlas-cli and packages/atlas-gateway (workspace packages `codelink-cli` and `codelink-gateway`) instead.',
    );
  }
}
