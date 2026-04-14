import * as z from 'zod';
import type { CardModel } from '../cards/CardModel.js';
import type { RuntimeSession, WatchRuntimeState } from '../runtime/RuntimeModels.js';

export const WatchControlActionSchema = z.enum(['focus', 'show-latest-output', 'unwatch']);

export const WatchControlPayloadSchema = z.object({
  v: z.literal(1),
  kind: z.literal('watch-control'),
  action: WatchControlActionSchema,
  bindingId: z.string().min(1),
  runtimeId: z.string().min(1),
});

export type WatchControlAction = z.infer<typeof WatchControlActionSchema>;
export type WatchControlPayload = z.infer<typeof WatchControlPayloadSchema>;

export function parseWatchControlPayload(value: unknown): WatchControlPayload | null {
  const parsed = WatchControlPayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function createWatchControlPayload(
  action: WatchControlAction,
  bindingId: string,
  runtimeId: string,
): WatchControlPayload {
  return {
    v: 1,
    kind: 'watch-control',
    action,
    bindingId,
    runtimeId,
  };
}

export interface WatchNotificationCardParams {
  bindingId: string;
  runtimeId: string;
  runtimeLabel: string;
  status: 'done' | 'waiting' | 'error';
  message: string;
  watchState: WatchRuntimeState;
  runtimeStatus?: RuntimeSession['status'];
}

export function buildWatchNotificationCard(params: WatchNotificationCardParams): CardModel {
  const sections: CardModel['sections'] = [
    { type: 'markdown', content: params.message },
    {
      type: 'fields',
      fields: [
        { label: 'Runtime', value: params.runtimeLabel, short: true },
        { label: 'Unread', value: String(params.watchState.unreadCount), short: true },
      ],
    },
  ];

  if (params.runtimeStatus) {
    sections.push({
      type: 'fields',
      fields: [{ label: 'Status', value: params.runtimeStatus, short: true }],
    });
  }

  if (params.watchState.lastSummary) {
    sections.push({ type: 'note', content: `Latest: ${params.watchState.lastSummary}` });
  }

  return {
    header: {
      title: `Watching Runtime: ${params.runtimeLabel}`,
      status: params.status,
    },
    sections,
    actions: [
      {
        type: 'button',
        label: 'Show Latest Output',
        style: 'default',
        value: createWatchControlPayload('show-latest-output', params.bindingId, params.runtimeId),
      },
      {
        type: 'button',
        label: 'Focus Runtime',
        style: 'primary',
        value: createWatchControlPayload('focus', params.bindingId, params.runtimeId),
      },
      {
        type: 'button',
        label: 'Stop Watching',
        style: 'default',
        value: createWatchControlPayload('unwatch', params.bindingId, params.runtimeId),
      },
    ],
  };
}
