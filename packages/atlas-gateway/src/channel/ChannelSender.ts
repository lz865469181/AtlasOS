import type { CardModel } from '../cards/CardModel.js';

export interface ChannelSender {
  sendText(text: string, replyTo?: string): Promise<string>;
  sendMarkdown(md: string, replyTo?: string): Promise<string>;
  sendCard(card: CardModel, replyTo?: string): Promise<string>;
  updateCard(messageId: string, card: CardModel): Promise<void>;
  addReaction?(messageId: string, emoji: string): Promise<void>;
  removeReaction?(messageId: string, emoji: string): Promise<void>;
  sendImage?(imageData: Buffer, replyTo?: string): Promise<string>;
  sendFile?(fileData: Buffer, filename: string, replyTo?: string): Promise<string>;
  showTyping?(chatId: string): Promise<void>;
}

/**
 * Factory that creates a ChannelSender scoped to a specific chat.
 * Used by CardRenderPipeline to resolve senders per card.
 * @param channelIdHint – optional override when no session exists yet (e.g. command handling before session creation).
 */
export type SenderFactory = (chatId: string, channelIdHint?: string) => ChannelSender;
