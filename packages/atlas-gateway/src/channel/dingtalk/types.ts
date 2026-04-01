// ── DingTalk incoming message event ─────────────────────────────────────────

/** Incoming message from DingTalk robot callback. */
export interface DingTalkMessageEvent {
  msgtype: string;
  text?: { content: string };
  senderStaffId: string;
  senderNick?: string;
  conversationId: string;
  /** 1 = P2P (single chat), 2 = group chat */
  conversationType: '1' | '2';
  chatbotCorpId?: string;
  chatbotUserId?: string;
  /** Session webhook URL for fast reply (TTL-based). */
  sessionWebhook: string;
  sessionWebhookExpiredTime: number;
  msgId: string;
  createAt?: number;
  /** Whether the bot was @-mentioned in the message. */
  isInAtList?: boolean;
  atUsers?: Array<{
    dingtalkId: string;
    staffId?: string;
  }>;
}

// ── DingTalk Stream event wrapper ───────────────────────────────────────────

/** DingTalk Stream event wrapper. */
export interface DingTalkStreamEvent {
  specVersion: string;
  type: string;
  headers: Record<string, string>;
  /** JSON-encoded DingTalkMessageEvent */
  data: string;
}

// ── Card action callback ────────────────────────────────────────────────────

/** Card action callback from DingTalk interactive card. */
export interface DingTalkCardActionEvent {
  corpId?: string;
  chatbotCorpId?: string;
  chatbotUserId?: string;
  msgId?: string;
  conversationId?: string;
  senderStaffId?: string;
  value?: Record<string, unknown>;
}
