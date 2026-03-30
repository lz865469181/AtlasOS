import type { ChannelEvent } from './channelEvent.js';

export type MessageHandler = (event: ChannelEvent) => Promise<void>;

export interface ChannelAdapter {
  readonly id: string;
  start(handler: MessageHandler): Promise<void>;
  stop(): Promise<void>;
  getSender(chatId: string): import('./ChannelSender.js').ChannelSender;
}
