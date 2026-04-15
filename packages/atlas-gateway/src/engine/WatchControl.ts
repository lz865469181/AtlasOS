import * as z from 'zod';
import type { CardModel } from '../cards/CardModel.js';
import type { RuntimeSession, WatchRuntimeState } from '../runtime/RuntimeModels.js';
import type { CardViewMode } from './CardViewControl.js';

export const WatchControlActionSchema = z.enum([
  'focus',
  'show-latest-output',
  'view-latest',
  'view-status',
  'unwatch',
]);

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
  view?: CardViewMode;
}

export function buildWatchNotificationCard(params: WatchNotificationCardParams): CardModel {
  const view = params.view ?? 'latest';
  const sections: CardModel['sections'] = [{ type: 'markdown', content: params.message }];

  if (view === 'latest') {
    const latestOutput = params.watchState.lastOutputPreview?.trim();
    const latestContent = latestOutput || params.watchState.lastSummary || 'No captured output yet.';
    sections.push({
      type: 'fields',
      fields: [
        { label: 'Runtime', value: params.runtimeLabel, short: true },
        { label: 'Unread', value: String(params.watchState.unreadCount), short: true },
      ],
    });
    sections.push({ type: 'markdown', content: `\`\`\`text\n${latestContent.replace(/```/g, "'''")}\n\`\`\`` });
  } else {
    sections.push({
      type: 'fields',
      fields: [
        { label: 'Runtime', value: params.runtimeLabel, short: true },
        { label: 'Unread', value: String(params.watchState.unreadCount), short: true },
        { label: 'Status', value: params.runtimeStatus ?? 'unknown', short: true },
      ],
    });
    sections.push({
      type: 'note',
      content: params.watchState.lastSummary
        ? `Latest: ${params.watchState.lastSummary}`
        : 'No summary yet.',
    });
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
        label: 'Latest',
        style: view === 'latest' ? 'primary' : 'default',
        value: createWatchControlPayload('view-latest', params.bindingId, params.runtimeId),
      },
      {
        type: 'button',
        label: 'Status',
        style: view === 'status' ? 'primary' : 'default',
        value: createWatchControlPayload('view-status', params.bindingId, params.runtimeId),
      },
      {
        type: 'button',
        label: 'Focus Runtime',
        style: 'default',
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
