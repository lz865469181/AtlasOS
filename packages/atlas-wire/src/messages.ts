import * as z from 'zod';
import { sessionEnvelopeSchema } from './sessionProtocol.js';
import { MessageMetaSchema, type MessageMeta } from './messageMeta.js';
import { AgentMessageSchema, UserMessageSchema } from './legacyProtocol.js';

export const SessionMessageContentSchema = z.object({ c: z.string(), t: z.literal('encrypted') });
export type SessionMessageContent = z.infer<typeof SessionMessageContentSchema>;

export const SessionMessageSchema = z.object({
  id: z.string(), seq: z.number(), localId: z.string().nullish(),
  content: SessionMessageContentSchema, createdAt: z.number(), updatedAt: z.number(),
});
export type SessionMessage = z.infer<typeof SessionMessageSchema>;

export { MessageMetaSchema };
export type { MessageMeta };

export const SessionProtocolMessageSchema = z.object({
  role: z.literal('session'), content: sessionEnvelopeSchema, meta: MessageMetaSchema.optional(),
});
export type SessionProtocolMessage = z.infer<typeof SessionProtocolMessageSchema>;

export const MessageContentSchema = z.discriminatedUnion('role', [
  UserMessageSchema, AgentMessageSchema, SessionProtocolMessageSchema,
]);
export type MessageContent = z.infer<typeof MessageContentSchema>;

export const UpdateNewMessageBodySchema = z.object({
  t: z.literal('new-message'), sid: z.string(), message: SessionMessageSchema,
});
export type UpdateNewMessageBody = z.infer<typeof UpdateNewMessageBodySchema>;

export const UpdateSessionBodySchema = z.object({
  t: z.literal('update-session'), id: z.string(),
  metadata: z.unknown().optional(), agentState: z.unknown().optional(),
});
export type UpdateSessionBody = z.infer<typeof UpdateSessionBodySchema>;

export const CoreUpdateBodySchema = z.discriminatedUnion('t', [
  UpdateNewMessageBodySchema, UpdateSessionBodySchema,
]);
export type CoreUpdateBody = z.infer<typeof CoreUpdateBodySchema>;

export const CoreUpdateContainerSchema = z.object({
  id: z.string(), seq: z.number(), body: CoreUpdateBodySchema, createdAt: z.number(),
});
export type CoreUpdateContainer = z.infer<typeof CoreUpdateContainerSchema>;
