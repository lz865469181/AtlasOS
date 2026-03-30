import { describe, it, expect } from 'vitest';
import { CardModelSchema, type CardModel } from './CardModel.js';

describe('CardModelSchema', () => {
  it('should parse minimal card', () => {
    const card = CardModelSchema.parse({ sections: [] });
    expect(card.sections).toEqual([]);
  });

  it('should parse full card', () => {
    const card: CardModel = {
      header: { title: 'Test', status: 'running' },
      sections: [
        { type: 'markdown', content: '**hello**' },
        { type: 'divider' },
        { type: 'fields', fields: [{ label: 'Agent', value: 'Claude', short: true }] },
      ],
      actions: [
        { type: 'button', label: 'Allow', value: 'allow', style: 'primary' },
        { type: 'button', label: 'Deny', value: 'deny', style: 'danger' },
      ],
    };
    const result = CardModelSchema.parse(card);
    expect(result.header?.status).toBe('running');
    expect(result.sections).toHaveLength(3);
    expect(result.actions).toHaveLength(2);
  });
});
