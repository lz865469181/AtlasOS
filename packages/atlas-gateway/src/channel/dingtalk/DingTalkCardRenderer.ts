import type { CardModel, CardSection, CardAction } from '../../cards/CardModel.js';
import type { CardRenderer } from '../../engine/CardRenderPipeline.js';
import type { DingTalkActionCard } from './DingTalkClient.js';

// ── DingTalkCardRenderer ────────────────────────────────────────────────────

export class DingTalkCardRenderer implements CardRenderer {
  render(
    card: CardModel,
    _context: { status: string; type: string },
  ): CardModel {
    // Pass-through — status decoration is handled by the pipeline.
    return card;
  }

  /** Convert CardModel → DingTalk ActionCard. */
  toActionCard(card: CardModel): DingTalkActionCard {
    const md = this.toMarkdown(card);
    const title = card.header?.title ?? 'Message';

    const result: DingTalkActionCard = { title, text: md };

    // Map actions to buttons
    if (card.actions && card.actions.length > 0) {
      if (card.actions.length === 1) {
        // Single button → singleTitle/singleURL
        const action = card.actions[0]!;
        result.singleTitle = action.label;
        result.singleURL = `dingtalk://action?value=${encodeURIComponent(action.value)}`;
      } else {
        // Multiple buttons
        result.btnOrientation = '1'; // horizontal
        result.btns = card.actions.map((a: CardAction) => ({
          title: a.label,
          actionURL: `dingtalk://action?value=${encodeURIComponent(a.value)}`,
        }));
      }
    }

    return result;
  }

  /** Convert CardModel → plain markdown string. */
  toMarkdown(card: CardModel): string {
    const parts: string[] = [];

    // Header
    if (card.header) {
      const statusEmoji = this.statusEmoji(card.header.status);
      parts.push(`### ${statusEmoji}${card.header.title}`);
      if (card.header.subtitle) {
        parts.push(card.header.subtitle);
      }
      parts.push('');
    }

    // Sections
    for (const section of card.sections) {
      parts.push(this.renderSection(section));
    }

    return parts.join('\n').trim();
  }

  private renderSection(section: CardSection): string {
    switch (section.type) {
      case 'markdown':
        return section.content + '\n';
      case 'divider':
        return '---\n';
      case 'fields': {
        const lines = section.fields.map((f) => `**${f.label}**: ${f.value}`);
        return lines.join('\n') + '\n';
      }
      case 'note':
        return `> ${section.content}\n`;
      default:
        return '';
    }
  }

  private statusEmoji(status?: string): string {
    switch (status) {
      case 'running': return '⏳ ';
      case 'done': return '✅ ';
      case 'error': return '❌ ';
      case 'waiting': return '⏸️ ';
      default: return '';
    }
  }
}
