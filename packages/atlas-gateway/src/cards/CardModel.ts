import * as z from 'zod';

export const CardHeaderSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  icon: z.string().optional(),
  status: z.enum(['running', 'done', 'error', 'waiting']).optional(),
});

export const CardFieldSchema = z.object({
  label: z.string(),
  value: z.string(),
  short: z.boolean().optional(),
});

export const CardSectionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('markdown'), content: z.string() }),
  z.object({ type: z.literal('fields'), fields: z.array(CardFieldSchema) }),
  z.object({ type: z.literal('divider') }),
  z.object({ type: z.literal('note'), content: z.string() }),
]);

export const CardActionSchema = z.object({
  type: z.enum(['button', 'select']),
  label: z.string(),
  value: z.string(),
  style: z.enum(['primary', 'danger', 'default']).optional(),
});

export const CardModelSchema = z.object({
  header: CardHeaderSchema.optional(),
  sections: z.array(CardSectionSchema),
  actions: z.array(CardActionSchema).optional(),
});

export type CardHeader = z.infer<typeof CardHeaderSchema>;
export type CardField = z.infer<typeof CardFieldSchema>;
export type CardSection = z.infer<typeof CardSectionSchema>;
export type CardAction = z.infer<typeof CardActionSchema>;
export type CardModel = z.infer<typeof CardModelSchema>;
