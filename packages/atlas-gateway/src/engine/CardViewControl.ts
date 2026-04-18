import * as z from 'zod';
import type { CardAction, CardField, CardSection } from '../cards/CardModel.js';
import type { CardState } from './CardStateStore.js';

export const CardViewModeSchema = z.enum(['latest', 'status']);

export const CardViewPayloadSchema = z.object({
  v: z.literal(1),
  kind: z.literal('card-view'),
  view: CardViewModeSchema,
});

export type CardViewMode = z.infer<typeof CardViewModeSchema>;
export type CardViewPayload = z.infer<typeof CardViewPayloadSchema>;

export function parseCardViewPayload(value: unknown): CardViewPayload | null {
  const parsed = CardViewPayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function createCardViewPayload(view: CardViewMode): CardViewPayload {
  return {
    v: 1,
    kind: 'card-view',
    view,
  };
}

export function buildCardViewActions(selectedView: CardViewMode): CardAction[] {
  return [
    {
      type: 'button',
      label: 'Latest',
      style: selectedView === 'latest' ? 'primary' : 'default',
      value: createCardViewPayload('latest'),
    },
    {
      type: 'button',
      label: 'Status',
      style: selectedView === 'status' ? 'primary' : 'default',
      value: createCardViewPayload('status'),
    },
  ];
}

export function renderActiveCardView(state: CardState, view: CardViewMode): {
  sections: CardSection[];
  actions: CardAction[];
} | null {
  const cardKind = String(state.metadata['activeCardKind'] ?? '');

  if (cardKind === 'streaming') {
    const latest = String(state.metadata['streamFullText'] ?? '');
    const summary = String(state.metadata['streamLastSummary'] ?? '');
    const latestSections: CardSection[] = [
      { type: 'markdown', content: latest || '_No output yet._' },
    ];
    const statusSections: CardSection[] = [
      {
        type: 'fields',
        fields: [
          { label: 'Card', value: 'streaming', short: true },
          { label: 'Status', value: state.content.header?.status ?? state.status, short: true },
          { label: 'Chars', value: String(latest.length), short: true },
        ] satisfies CardField[],
      },
      { type: 'note', content: summary || 'No summary yet.' },
    ];
    return { sections: view === 'latest' ? latestSections : statusSections, actions: buildCardViewActions(view) };
  }

  if (cardKind === 'status') {
    const detail = String(state.metadata['statusDetail'] ?? '');
    const agentStatus = String(state.metadata['agentStatus'] ?? state.content.header?.status ?? state.status);
    const latestSections: CardSection[] = [
      { type: 'note', content: detail || 'No status detail.' },
    ];
    const statusSections: CardSection[] = [
      {
        type: 'fields',
        fields: [
          { label: 'Card', value: 'status', short: true },
          { label: 'Status', value: agentStatus, short: true },
        ] satisfies CardField[],
      },
      { type: 'note', content: detail || 'No status detail.' },
    ];
    return { sections: view === 'latest' ? latestSections : statusSections, actions: buildCardViewActions(view) };
  }

  if (cardKind === 'terminal') {
    const command = String(state.metadata['terminalCommand'] ?? '');
    const output = String(state.metadata['terminalOutput'] ?? '');
    const lastLine = String(state.metadata['terminalLastSummary'] ?? '');
    const cwd = String(state.metadata['terminalCwd'] ?? '');
    const exitCode = state.metadata['terminalExitCode'];
    const latestSections: CardSection[] = [];
    if (command) {
      latestSections.push({ type: 'markdown', content: `\`\`\`shell\n${command}\n\`\`\`` });
    }
    if (cwd) {
      latestSections.push({ type: 'note', content: `cwd: ${cwd}` });
    }
    latestSections.push({
      type: 'markdown',
      content: `\`\`\`\n${output || 'No terminal output yet.'}\n\`\`\``,
    });

    const statusSections: CardSection[] = [
      {
        type: 'fields',
        fields: [
          { label: 'Card', value: 'terminal', short: true },
          { label: 'Status', value: state.content.header?.status ?? state.status, short: true },
          { label: 'Command', value: command || '-', short: true },
          { label: 'CWD', value: cwd || '-', short: true },
          { label: 'Exit', value: exitCode == null ? '-' : String(exitCode), short: true },
          { label: 'Chars', value: String(output.length), short: true },
        ],
      },
      { type: 'note', content: lastLine || 'No summary yet.' },
    ];

    return {
      sections: view === 'latest' ? latestSections : statusSections,
      actions: buildCardViewActions(view),
    };
  }

  return null;
}
