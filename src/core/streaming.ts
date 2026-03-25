import type { PlatformSender } from "./interfaces.js";

export interface StreamPreviewConfig {
  intervalMs: number;
  minDeltaChars: number;
  maxChars: number;
}

const DEFAULT_CONFIG: StreamPreviewConfig = {
  intervalMs: 1500,
  minDeltaChars: 300,
  maxChars: 4000,
};

export class StreamPreview {
  private buffer = "";
  private lastSent = "";
  private lastSentAt = 0;
  private messageId?: string;
  private frozen = false;
  private timer?: ReturnType<typeof setTimeout>;
  private config: StreamPreviewConfig;

  constructor(
    private chatID: string,
    private sender: PlatformSender,
    config?: Partial<StreamPreviewConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  append(text: string): void {
    this.buffer += text;
    if (!this.frozen) this.scheduleUpdate();
  }

  freeze(): void {
    this.frozen = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  unfreeze(): void {
    this.frozen = false;
    this.scheduleUpdate();
  }

  discard(): void {
    this.buffer = "";
    this.frozen = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  finish(): string {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    return this.buffer;
  }

  private scheduleUpdate(): void {
    if (this.timer) return;
    const elapsed = Date.now() - this.lastSentAt;
    const delay = Math.max(0, this.config.intervalMs - elapsed);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, delay);
  }

  private async flush(): Promise<void> {
    if (this.frozen) return;
    const content = this.buffer.length > this.config.maxChars
      ? this.buffer.slice(0, this.config.maxChars) + "\n\n... (streaming)"
      : this.buffer;

    if (content === this.lastSent) return;
    if (content.length - this.lastSent.length < this.config.minDeltaChars) return;

    try {
      if (this.messageId && this.sender.updateMarkdown) {
        await this.sender.updateMarkdown(this.messageId, content);
      } else {
        const id = await this.sender.sendMarkdown(this.chatID, content);
        if (id) this.messageId = id;
      }
      this.lastSent = content;
      this.lastSentAt = Date.now();
    } catch {
      // Ignore update failures (message may have been deleted)
    }
  }
}
