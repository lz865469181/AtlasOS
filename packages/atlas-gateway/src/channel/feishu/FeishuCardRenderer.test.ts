import { describe, it, expect, beforeEach } from 'vitest';
import { FeishuCardRenderer } from './FeishuCardRenderer.js';
import type { CardModel } from '../../cards/CardModel.js';

describe('FeishuCardRenderer', () => {
  let renderer: FeishuCardRenderer;

  beforeEach(() => {
    renderer = new FeishuCardRenderer();
  });

  // ── render() ──────────────────────────────────────────────────────────

  describe('render', () => {
    it('passes through card as-is when header has status', () => {
      const card: CardModel = {
        header: { title: 'Test', status: 'done' },
        sections: [{ type: 'markdown', content: 'hello' }],
      };
      const result = renderer.render(card, { status: 'completed', type: 'tool' });
      expect(result).toBe(card); // same reference
    });

    it('infers header status from context when header has no status', () => {
      const card: CardModel = {
        header: { title: 'Test' },
        sections: [],
      };
      const result = renderer.render(card, { status: 'active', type: 'streaming' });
      expect(result.header?.status).toBe('running');
    });

    it('maps completed status to done', () => {
      const card: CardModel = {
        header: { title: 'Test' },
        sections: [],
      };
      const result = renderer.render(card, { status: 'completed', type: 'tool' });
      expect(result.header?.status).toBe('done');
    });

    it('maps error status to error', () => {
      const card: CardModel = {
        header: { title: 'Test' },
        sections: [],
      };
      const result = renderer.render(card, { status: 'error', type: 'tool' });
      expect(result.header?.status).toBe('error');
    });

    it('returns card as-is when no header', () => {
      const card: CardModel = {
        sections: [{ type: 'markdown', content: 'no header' }],
      };
      const result = renderer.render(card, { status: 'active', type: 'streaming' });
      expect(result).toBe(card);
    });
  });

  // ── toFeishuJson() ────────────────────────────────────────────────────

  describe('toFeishuJson', () => {
    it('sets wide_screen_mode config', () => {
      const card: CardModel = { sections: [] };
      const json = renderer.toFeishuJson(card);
      expect(json.config.wide_screen_mode).toBe(true);
    });

    it('renders header with title and template color', () => {
      const card: CardModel = {
        header: { title: 'My Card', status: 'running' },
        sections: [],
      };
      const json = renderer.toFeishuJson(card);
      expect(json.header).toEqual({
        title: { tag: 'plain_text', content: 'My Card' },
        template: 'blue',
      });
    });

    it('maps done status to green template', () => {
      const card: CardModel = {
        header: { title: 'Done', status: 'done' },
        sections: [],
      };
      const json = renderer.toFeishuJson(card);
      expect(json.header?.template).toBe('green');
    });

    it('maps error status to red template', () => {
      const card: CardModel = {
        header: { title: 'Error', status: 'error' },
        sections: [],
      };
      const json = renderer.toFeishuJson(card);
      expect(json.header?.template).toBe('red');
    });

    it('maps waiting status to yellow template', () => {
      const card: CardModel = {
        header: { title: 'Wait', status: 'waiting' },
        sections: [],
      };
      const json = renderer.toFeishuJson(card);
      expect(json.header?.template).toBe('yellow');
    });

    it('defaults to blue template when no status', () => {
      const card: CardModel = {
        header: { title: 'Default' },
        sections: [],
      };
      const json = renderer.toFeishuJson(card);
      expect(json.header?.template).toBe('blue');
    });

    it('includes subtitle when present', () => {
      const card: CardModel = {
        header: { title: 'Title', subtitle: 'sub' },
        sections: [],
      };
      const json = renderer.toFeishuJson(card);
      expect(json.header?.subtitle).toEqual({ tag: 'plain_text', content: 'sub' });
    });

    it('renders markdown section', () => {
      const card: CardModel = {
        sections: [{ type: 'markdown', content: '**bold** text' }],
      };
      const json = renderer.toFeishuJson(card);
      expect(json.elements).toEqual([
        { tag: 'markdown', content: '**bold** text' },
      ]);
    });

    it('renders divider section', () => {
      const card: CardModel = {
        sections: [{ type: 'divider' }],
      };
      const json = renderer.toFeishuJson(card);
      expect(json.elements).toEqual([{ tag: 'hr' }]);
    });

    it('renders note section', () => {
      const card: CardModel = {
        sections: [{ type: 'note', content: 'A note' }],
      };
      const json = renderer.toFeishuJson(card);
      expect(json.elements).toEqual([
        {
          tag: 'note',
          elements: [{ tag: 'plain_text', content: 'A note' }],
        },
      ]);
    });

    it('renders fields section as column_set', () => {
      const card: CardModel = {
        sections: [
          {
            type: 'fields',
            fields: [
              { label: 'Status', value: 'Running', short: true },
              { label: 'Time', value: '2m', short: true },
            ],
          },
        ],
      };
      const json = renderer.toFeishuJson(card);
      expect(json.elements).toHaveLength(1);
      const colSet = json.elements[0] as { tag: 'column_set'; columns: unknown[] };
      expect(colSet.tag).toBe('column_set');
      expect(colSet.columns).toHaveLength(2);
    });

    it('renders actions as button group', () => {
      const card: CardModel = {
        sections: [],
        actions: [
          { type: 'button', label: 'Yes', value: 'approve', style: 'primary' },
          { type: 'button', label: 'No', value: 'deny', style: 'danger' },
        ],
      };
      const json = renderer.toFeishuJson(card);
      const actionEl = json.elements[0] as { tag: 'action'; actions: unknown[] };
      expect(actionEl.tag).toBe('action');
      expect(actionEl.actions).toHaveLength(2);
      expect(actionEl.actions[0]).toEqual({
        tag: 'button',
        text: { tag: 'plain_text', content: 'Yes' },
        type: 'primary',
        value: 'approve',
      });
    });

    it('renders multiple sections in order', () => {
      const card: CardModel = {
        header: { title: 'Multi' },
        sections: [
          { type: 'markdown', content: 'first' },
          { type: 'divider' },
          { type: 'markdown', content: 'second' },
          { type: 'note', content: 'footer' },
        ],
      };
      const json = renderer.toFeishuJson(card);
      expect(json.elements).toHaveLength(4);
      expect(json.elements[0]).toEqual({ tag: 'markdown', content: 'first' });
      expect(json.elements[1]).toEqual({ tag: 'hr' });
      expect(json.elements[2]).toEqual({ tag: 'markdown', content: 'second' });
      expect(json.elements[3]).toEqual({
        tag: 'note',
        elements: [{ tag: 'plain_text', content: 'footer' }],
      });
    });
  });

  // ── toFeishuJsonString() ──────────────────────────────────────────────

  describe('toFeishuJsonString', () => {
    it('returns valid JSON string', () => {
      const card: CardModel = {
        header: { title: 'Test' },
        sections: [{ type: 'markdown', content: 'hello' }],
      };
      const str = renderer.toFeishuJsonString(card);
      const parsed = JSON.parse(str);
      expect(parsed.config.wide_screen_mode).toBe(true);
      expect(parsed.header.title.content).toBe('Test');
      expect(parsed.elements[0].content).toBe('hello');
    });
  });
});
