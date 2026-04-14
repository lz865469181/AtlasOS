import { describe, it, expect } from 'vitest';
import { DingTalkCardRenderer } from './DingTalkCardRenderer.js';

const renderer = new DingTalkCardRenderer();

describe('DingTalkCardRenderer', () => {
  describe('toMarkdown', () => {
    it('minimal card without header renders one markdown section', () => {
      const card = {
        sections: [{ type: 'markdown' as const, content: 'Hello world' }],
      };
      expect(renderer.toMarkdown(card)).toBe('Hello world');
    });

    it('full card renders header, fields, divider, and note', () => {
      const card = {
        header: {
          title: 'Build Report',
          subtitle: 'pipeline #42',
          status: 'running' as const,
        },
        sections: [
          {
            type: 'fields' as const,
            fields: [
              { label: 'Branch', value: 'main' },
              { label: 'Commit', value: 'abc1234' },
            ],
          },
          { type: 'divider' as const },
          { type: 'note' as const, content: 'Triggered by CI' },
        ],
      };

      const md = renderer.toMarkdown(card);
      const lines = md.split('\n');

      expect(lines[0]).toBe('### ⏳ Build Report');
      expect(lines[1]).toBe('pipeline #42');
      expect(lines[2]).toBe('');
      expect(md).toContain('**Branch**: main');
      expect(md).toContain('**Commit**: abc1234');
      expect(md).toContain('---');
      expect(md).toContain('> Triggered by CI');
    });
  });

  describe('toActionCard', () => {
    it('maps a single button to singleTitle and singleURL', () => {
      const card = {
        sections: [{ type: 'markdown' as const, content: 'Click below' }],
        actions: [{ type: 'button' as const, label: 'Open', value: 'open_link' }],
      };

      const ac = renderer.toActionCard(card);

      expect(ac.title).toBe('Message');
      expect(ac.singleTitle).toBe('Open');
      expect(ac.singleURL).toBe('dingtalk://action?value=open_link');
      expect(ac.btns).toBeUndefined();
      expect(ac.btnOrientation).toBeUndefined();
    });

    it('maps multiple buttons to the horizontal btn list', () => {
      const card = {
        header: { title: 'Confirm' },
        sections: [{ type: 'markdown' as const, content: 'Choose one' }],
        actions: [
          { type: 'button' as const, label: 'Approve', value: 'yes' },
          { type: 'button' as const, label: 'Reject', value: 'no' },
        ],
      };

      const ac = renderer.toActionCard(card);

      expect(ac.title).toBe('Confirm');
      expect(ac.btnOrientation).toBe('1');
      expect(ac.btns).toEqual([
        { title: 'Approve', actionURL: 'dingtalk://action?value=yes' },
        { title: 'Reject', actionURL: 'dingtalk://action?value=no' },
      ]);
      expect(ac.singleTitle).toBeUndefined();
      expect(ac.singleURL).toBeUndefined();
    });

    it('serializes object action values before encoding button URLs', () => {
      const card = {
        header: { title: 'Watcher' },
        sections: [{ type: 'markdown' as const, content: 'Take action' }],
        actions: [
          {
            type: 'button' as const,
            label: 'Focus Runtime',
            value: { v: 1, kind: 'watch-control', action: 'focus', runtimeId: 'runtime-1' },
          },
        ],
      };

      const ac = renderer.toActionCard(card);

      expect(ac.singleURL).toBe(
        'dingtalk://action?value=%7B%22v%22%3A1%2C%22kind%22%3A%22watch-control%22%2C%22action%22%3A%22focus%22%2C%22runtimeId%22%3A%22runtime-1%22%7D',
      );
    });

    it('omits button fields when the card has no actions', () => {
      const card = {
        sections: [{ type: 'markdown' as const, content: 'Info only' }],
      };

      const ac = renderer.toActionCard(card);

      expect(ac.title).toBe('Message');
      expect(ac.text).toBe('Info only');
      expect(ac.btns).toBeUndefined();
      expect(ac.singleTitle).toBeUndefined();
      expect(ac.singleURL).toBeUndefined();
      expect(ac.btnOrientation).toBeUndefined();
    });
  });

  describe('render', () => {
    it('returns the card unchanged', () => {
      const card = {
        header: { title: 'Test' },
        sections: [{ type: 'markdown' as const, content: 'body' }],
      };

      const result = renderer.render(card, { status: 'ok', type: 'chat' });

      expect(result).toBe(card);
    });
  });
});
