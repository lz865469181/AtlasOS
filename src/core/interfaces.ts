// Re-export agent types so core/ consumers don't import from agent/
export type {
  Agent, AgentSession, AgentEvent, AgentSessionOpts,
  TokenUsage, AskQuestion, SessionInfo, ProviderConfig,
  ModelSwitcher, ModeSwitcher, LiveModeSwitcher, ProviderSwitcher,
  MemoryFileProvider, CommandProvider, SkillProvider,
  ContextCompressor, UsageReporter, FormattingInstructionProvider,
} from "../agent/types.js";

// Re-export platform types so core/ consumers don't import from platform/
export type {
  MessageEvent, PlatformSender, MessageHandler, PlatformAdapter,
  CardActionEvent, CardActionHandler, Attachment,
  InlineButtonSender, ImageSender, FileSender, AudioSender,
  TypingIndicator, MessageUpdater, ButtonOption,
} from "../platform/types.js";

// Re-export capability detection helpers
export {
  supportsModelSwitching, supportsModeSwitching, supportsLiveModeSwitching,
  supportsProviderSwitching, supportsMemoryFiles, supportsContextCompression,
} from "../agent/types.js";

export {
  supportsInlineButtons, supportsImages, supportsFiles,
  supportsAudio, supportsTyping,
} from "../platform/types.js";

// ─── Reply Context ───────────────────────────────────────────────────────────

/** Platform-agnostic reply routing info. */
export interface ReplyContext {
  platform: string;
  chatID: string;
  chatType: "p2p" | "group";
  userID: string;
  messageID?: string;
}
