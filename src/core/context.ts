import { log } from "./logger.js";
import { estimateTokens } from "./utils.js";

export interface ContextManagerConfig {
  maxTokens: number;
  preserveRecent: number;
}

const DEFAULT_CONFIG: ContextManagerConfig = {
  maxTokens: 150_000,
  preserveRecent: 10,
};

export class ContextManager {
  private config: ContextManagerConfig;

  constructor(config?: Partial<ContextManagerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Check if a conversation (as total text) exceeds the token threshold. */
  shouldCompress(totalText: string): boolean {
    return estimateTokens(totalText) >= this.config.maxTokens;
  }

  get maxTokens(): number { return this.config.maxTokens; }
  get preserveRecent(): number { return this.config.preserveRecent; }
}
