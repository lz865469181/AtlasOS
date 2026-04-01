// ── DingTalk Client ─────────────────────────────────────────────────────────

export interface DingTalkClientConfig {
  appKey: string;
  appSecret: string;
  /** Base URL for DingTalk API. Defaults to 'https://api.dingtalk.com'. */
  baseUrl?: string;
}

export interface DingTalkActionCard {
  title: string;
  /** Markdown content */
  text: string;
  /** 0 = vertical, 1 = horizontal */
  btnOrientation?: '0' | '1';
  btns?: Array<{ title: string; actionURL: string }>;
  singleTitle?: string;
  singleURL?: string;
}

/** Minimal interface over the DingTalk API we consume. Injectable for testing. */
export interface DingTalkClient {
  /** Get or refresh the access token (cached, auto-refresh). */
  getAccessToken(): Promise<string>;

  /** Send text via OpenAPI to a conversation. */
  sendText(conversationId: string, text: string): Promise<string>;

  /** Send markdown via OpenAPI to a conversation. */
  sendMarkdown(conversationId: string, title: string, text: string): Promise<string>;

  /** Send ActionCard (interactive card) via OpenAPI. */
  sendActionCard(conversationId: string, card: DingTalkActionCard): Promise<string>;

  /** Update a message (DingTalk supports limited update via OpenAPI). */
  updateCard(messageId: string, card: DingTalkActionCard): Promise<void>;

  /** Send via session webhook (reply-only, no auth needed). */
  sendViaWebhook(webhookUrl: string, payload: unknown): Promise<void>;
}

// ── Token cache ─────────────────────────────────────────────────────────────

interface TokenCache {
  token: string;
  expiresAt: number;
}

// ── HTTP helper type ────────────────────────────────────────────────────────

/** Injectable HTTP POST function for testing. */
export type HttpPostFn = (
  url: string,
  body: unknown,
  headers?: Record<string, string>,
) => Promise<{ status: number; data: unknown }>;

// ── Logging helper ──────────────────────────────────────────────────────────

function log(level: string, msg: string, meta?: Record<string, unknown>): void {
  const entry = { time: new Date().toISOString(), level, msg, ...meta };
  console.log(JSON.stringify(entry));
}

// ── Implementation ──────────────────────────────────────────────────────────

export class DingTalkClientImpl implements DingTalkClient {
  private readonly config: DingTalkClientConfig;
  private readonly httpPost: HttpPostFn;
  private tokenCache: TokenCache | null = null;

  /** Buffer (ms) before token expiry to trigger refresh. */
  private static readonly TOKEN_REFRESH_BUFFER = 60_000;

  constructor(config: DingTalkClientConfig, httpPost: HttpPostFn) {
    this.config = config;
    this.httpPost = httpPost;
  }

  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && now < this.tokenCache.expiresAt - DingTalkClientImpl.TOKEN_REFRESH_BUFFER) {
      return this.tokenCache.token;
    }

    const url = `${this.config.baseUrl ?? 'https://api.dingtalk.com'}/v1.0/oauth2/accessToken`;
    const resp = await this.httpPost(url, {
      appKey: this.config.appKey,
      appSecret: this.config.appSecret,
    });

    if (resp.status !== 200) {
      throw new Error(`DingTalk token request failed: status=${resp.status}`);
    }

    const data = resp.data as { accessToken?: string; expireIn?: number };
    if (!data.accessToken) {
      throw new Error('DingTalk token response missing accessToken');
    }

    this.tokenCache = {
      token: data.accessToken,
      // expireIn is in seconds
      expiresAt: now + (data.expireIn ?? 7200) * 1000,
    };
    return this.tokenCache.token;
  }

  async sendText(conversationId: string, text: string): Promise<string> {
    const token = await this.getAccessToken();
    const url = `${this.config.baseUrl ?? 'https://api.dingtalk.com'}/v1.0/robot/groupMessages/send`;
    const resp = await this.httpPost(
      url,
      {
        msgParam: JSON.stringify({ text: { content: text } }),
        msgKey: 'sampleText',
        openConversationId: conversationId,
      },
      { 'x-acs-dingtalk-access-token': token },
    );

    if (resp.status !== 200) {
      throw new Error(`DingTalk sendText failed: status=${resp.status}`);
    }

    const data = resp.data as { processQueryKey?: string };
    return data.processQueryKey ?? '';
  }

  async sendMarkdown(conversationId: string, title: string, text: string): Promise<string> {
    const token = await this.getAccessToken();
    const url = `${this.config.baseUrl ?? 'https://api.dingtalk.com'}/v1.0/robot/groupMessages/send`;
    const resp = await this.httpPost(
      url,
      {
        msgParam: JSON.stringify({ markdown: { title, text } }),
        msgKey: 'sampleMarkdown',
        openConversationId: conversationId,
      },
      { 'x-acs-dingtalk-access-token': token },
    );

    if (resp.status !== 200) {
      throw new Error(`DingTalk sendMarkdown failed: status=${resp.status}`);
    }

    const data = resp.data as { processQueryKey?: string };
    return data.processQueryKey ?? '';
  }

  async sendActionCard(conversationId: string, card: DingTalkActionCard): Promise<string> {
    const token = await this.getAccessToken();
    const url = `${this.config.baseUrl ?? 'https://api.dingtalk.com'}/v1.0/robot/groupMessages/send`;
    const resp = await this.httpPost(
      url,
      {
        msgParam: JSON.stringify({ actionCard: card }),
        msgKey: 'sampleActionCard',
        openConversationId: conversationId,
      },
      { 'x-acs-dingtalk-access-token': token },
    );

    if (resp.status !== 200) {
      throw new Error(`DingTalk sendActionCard failed: status=${resp.status}`);
    }

    const data = resp.data as { processQueryKey?: string };
    return data.processQueryKey ?? '';
  }

  async updateCard(messageId: string, card: DingTalkActionCard): Promise<void> {
    // DingTalk has limited card update support via OpenAPI.
    // For now, log a warning — full update requires interactive card registration.
    log('warn', 'DingTalk updateCard is not fully supported', { messageId, card: card.title });
  }

  async sendViaWebhook(webhookUrl: string, payload: unknown): Promise<void> {
    const resp = await this.httpPost(webhookUrl, payload);
    if (resp.status !== 200) {
      throw new Error(`DingTalk webhook send failed: status=${resp.status}`);
    }
  }
}
