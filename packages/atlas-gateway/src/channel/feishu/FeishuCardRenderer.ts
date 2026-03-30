import type { CardModel, CardSection, CardAction } from '../../cards/CardModel.js';
import type { CardRenderer } from '../../engine/CardRenderPipeline.js';

// ── Feishu card JSON types ────────────────────────────────────────────────

interface FeishuCardJson {
  config: { wide_screen_mode: boolean };
  header?: {
    title: { tag: 'plain_text'; content: string };
    subtitle?: { tag: 'plain_text'; content: string };
    icon?: { tag: 'standard_icon'; token: string };
    template: string;
  };
  elements: FeishuElement[];
}

type FeishuElement =
  | { tag: 'markdown'; content: string }
  | { tag: 'hr' }
  | { tag: 'note'; elements: Array<{ tag: 'plain_text'; content: string }> }
  | { tag: 'column_set'; columns: FeishuColumn[] }
  | { tag: 'action'; actions: FeishuButton[] }
  | { tag: 'div'; text: { tag: 'plain_text'; content: string } };

interface FeishuColumn {
  tag: 'column';
  width: 'weighted';
  weight: number;
  elements: Array<{ tag: 'markdown'; content: string }>;
}

interface FeishuButton {
  tag: 'button';
  text: { tag: 'plain_text'; content: string };
  type: 'primary' | 'danger' | 'default';
  value: unknown;
}

// ── Header color mapping ──────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  running: 'blue',
  done: 'green',
  error: 'red',
  waiting: 'yellow',
};

// ── Section renderers ─────────────────────────────────────────────────────

function renderSection(section: CardSection): FeishuElement | null {
  switch (section.type) {
    case 'markdown':
      return { tag: 'markdown', content: section.content };

    case 'divider':
      return { tag: 'hr' };

    case 'note':
      return {
        tag: 'note',
        elements: [{ tag: 'plain_text', content: section.content }],
      };

    case 'fields': {
      // Render as column_set: 2 columns per row for short fields, full-width for long
      const columns: FeishuColumn[] = section.fields.map((f) => ({
        tag: 'column' as const,
        width: 'weighted' as const,
        weight: f.short ? 1 : 2,
        elements: [
          { tag: 'markdown' as const, content: `**${f.label}**\n${f.value}` },
        ],
      }));
      return { tag: 'column_set', columns };
    }

    default:
      return null;
  }
}

function renderActions(actions: CardAction[]): FeishuElement {
  const buttons: FeishuButton[] = actions.map((a) => ({
    tag: 'button',
    text: { tag: 'plain_text', content: a.label },
    type: (a.style ?? 'default') as 'primary' | 'danger' | 'default',
    value: a.value,
  }));
  return { tag: 'action', actions: buttons };
}

// ── FeishuCardRenderer ────────────────────────────────────────────────────

export class FeishuCardRenderer implements CardRenderer {
  /**
   * Renders a CardModel into a CardModel that is "decorated" for Feishu.
   * The CardRenderPipeline calls this — it returns the same CardModel shape,
   * and the actual conversion to Feishu JSON happens in `toFeishuJson()`.
   */
  render(
    card: CardModel,
    context: { status: string; type: string },
  ): CardModel {
    // The renderer passes through the CardModel as-is.
    // Status decoration is applied: if the card has no header status,
    // infer it from the context.
    if (card.header && !card.header.status) {
      const inferredStatus = inferHeaderStatus(context.status);
      if (inferredStatus) {
        return {
          ...card,
          header: { ...card.header, status: inferredStatus },
        };
      }
    }
    return card;
  }

  /**
   * Convert a CardModel to Feishu interactive card JSON.
   * This is the main conversion method used by FeishuAdapter/ChannelSender.
   */
  toFeishuJson(card: CardModel): FeishuCardJson {
    const elements: FeishuElement[] = [];

    // Render sections
    for (const section of card.sections) {
      const el = renderSection(section);
      if (el) elements.push(el);
    }

    // Render actions
    if (card.actions && card.actions.length > 0) {
      elements.push(renderActions(card.actions));
    }

    // Build result
    const result: FeishuCardJson = {
      config: { wide_screen_mode: true },
      elements,
    };

    // Build header
    if (card.header) {
      result.header = {
        title: { tag: 'plain_text', content: card.header.title },
        template: STATUS_COLORS[card.header.status ?? ''] ?? 'blue',
      };
      if (card.header.subtitle) {
        result.header.subtitle = { tag: 'plain_text', content: card.header.subtitle };
      }
    }

    return result;
  }

  /**
   * Convenience: convert CardModel directly to JSON string for Feishu API.
   */
  toFeishuJsonString(card: CardModel): string {
    return JSON.stringify(this.toFeishuJson(card));
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function inferHeaderStatus(
  status: string,
): 'running' | 'done' | 'error' | 'waiting' | undefined {
  switch (status) {
    case 'active':
    case 'frozen':
      return 'running';
    case 'completed':
      return 'done';
    case 'error':
      return 'error';
    case 'expired':
      return 'waiting';
    default:
      return undefined;
  }
}
