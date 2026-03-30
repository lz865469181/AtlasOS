import * as z from 'zod';

export const ChannelEventSchema = z.object({
  channelId: z.string(),
  chatId: z.string(),
  userId: z.string(),
  userName: z.string(),
  messageId: z.string(),
  content: z.discriminatedUnion('type', [
    z.object({ type: z.literal('text'), text: z.string() }),
    z.object({ type: z.literal('image'), url: z.string(), mimeType: z.string().optional() }),
    z.object({ type: z.literal('file'), url: z.string(), filename: z.string(), mimeType: z.string().optional() }),
    z.object({ type: z.literal('audio'), url: z.string(), duration: z.number().optional() }),
  ]),
  timestamp: z.number(),
  replyToId: z.string().optional(),
});

export type ChannelEvent = z.infer<typeof ChannelEventSchema>;
export type UserMessageContent = ChannelEvent['content'];
