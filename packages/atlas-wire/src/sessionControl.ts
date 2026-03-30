import * as z from 'zod';

export const SessionCreateEventSchema = z.object({
  type: z.literal('session-create'), sessionId: z.string(), agentId: z.string(),
  cwd: z.string(), env: z.record(z.string(), z.string()).optional(),
});
export const SessionPauseEventSchema = z.object({ type: z.literal('session-pause'), sessionId: z.string() });
export const SessionResumeEventSchema = z.object({ type: z.literal('session-resume'), sessionId: z.string() });
export const SessionDestroyEventSchema = z.object({
  type: z.literal('session-destroy'), sessionId: z.string(), reason: z.string().optional(),
});

export const SessionControlEventSchema = z.discriminatedUnion('type', [
  SessionCreateEventSchema, SessionPauseEventSchema, SessionResumeEventSchema, SessionDestroyEventSchema,
]);
export type SessionControlEvent = z.infer<typeof SessionControlEventSchema>;
