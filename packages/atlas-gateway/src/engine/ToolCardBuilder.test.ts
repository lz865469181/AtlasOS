import { describe, it, expect, beforeEach } from 'vitest';
import { ToolCardBuilderImpl } from './ToolCardBuilder.js';
import type { ToolCardMeta } from './ToolCardBuilder.js';

describe('ToolCardBuilder', () => {
  let builder: ToolCardBuilderImpl;

  beforeEach(() => {
    builder = new ToolCardBuilderImpl();
  });

  // ── has / register ────────────────────────────────────────────────────

  describe('has', () => {
    it('returns true for known tools', () => {
      expect(builder.has('Bash')).toBe(true);
      expect(builder.has('Edit')).toBe(true);
      expect(builder.has('Read')).toBe(true);
      expect(builder.has('AskUserQuestion')).toBe(true);
      expect(builder.has('TodoWrite')).toBe(true);
    });

    it('returns false for unknown tools', () => {
      expect(builder.has('UnknownTool')).toBe(false);
    });
  });

  describe('register', () => {
    it('registers a custom tool', () => {
      const meta: ToolCardMeta = {
        title: 'Custom',
        icon: '🔧',
        category: 'meta',
        isMutable: false,
        minimal: false,
        hidden: false,
        buildCard() {
          return { sections: [{ type: 'markdown', content: 'custom' }] };
        },
      };
      builder.register('CustomTool', meta);
      expect(builder.has('CustomTool')).toBe(true);
    });
  });

  // ── getTitle ──────────────────────────────────────────────────────────

  describe('getTitle', () => {
    it('returns dynamic title for Bash with command', () => {
      const title = builder.getTitle('Bash', { command: 'ls -la' });
      expect(title).toBe('$ ls -la');
    });

    it('truncates long commands to 60 chars', () => {
      const longCmd = 'a'.repeat(100);
      const title = builder.getTitle('Bash', { command: longCmd });
      expect(title).toBe('$ ' + 'a'.repeat(60) + '...');
    });

    it('returns dynamic title for Edit with file_path', () => {
      const title = builder.getTitle('Edit', { file_path: '/src/index.ts' });
      expect(title).toBe('Edit /src/index.ts');
    });

    it('returns dynamic title for Write', () => {
      const title = builder.getTitle('Write', { file_path: '/tmp/out.txt' });
      expect(title).toBe('Write /tmp/out.txt');
    });

    it('returns dynamic title for Read', () => {
      const title = builder.getTitle('Read', { file_path: '/src/main.ts' });
      expect(title).toBe('Read /src/main.ts');
    });

    it('returns dynamic title for Glob', () => {
      const title = builder.getTitle('Glob', { pattern: '**/*.ts' });
      expect(title).toBe('Search **/*.ts');
    });

    it('returns dynamic title for Grep', () => {
      const title = builder.getTitle('Grep', { pattern: 'TODO' });
      expect(title).toBe('Grep TODO');
    });

    it('returns dynamic title for WebSearch', () => {
      const title = builder.getTitle('WebSearch', { query: 'vitest docs' });
      expect(title).toBe('Search: vitest docs');
    });

    it('returns static title for AskUserQuestion', () => {
      expect(builder.getTitle('AskUserQuestion', {})).toBe('Question');
    });

    it('returns static title for TodoWrite', () => {
      expect(builder.getTitle('TodoWrite', {})).toBe('Update Tasks');
    });

    it('returns tool name for unknown tools', () => {
      expect(builder.getTitle('SomethingNew', {})).toBe('SomethingNew');
    });
  });

  // ── isHidden / isMutable ──────────────────────────────────────────────

  describe('isHidden', () => {
    it('returns false for normal tools', () => {
      expect(builder.isHidden('Bash')).toBe(false);
      expect(builder.isHidden('Read')).toBe(false);
    });

    it('returns false for unknown tools', () => {
      expect(builder.isHidden('UnknownTool')).toBe(false);
    });
  });

  describe('isMutable', () => {
    it('returns true for mutable tools (Bash, Edit, Write)', () => {
      expect(builder.isMutable('Bash')).toBe(true);
      expect(builder.isMutable('Edit')).toBe(true);
      expect(builder.isMutable('Write')).toBe(true);
      expect(builder.isMutable('TodoWrite')).toBe(true);
    });

    it('returns false for readonly tools', () => {
      expect(builder.isMutable('Read')).toBe(false);
      expect(builder.isMutable('Glob')).toBe(false);
      expect(builder.isMutable('Grep')).toBe(false);
      expect(builder.isMutable('WebSearch')).toBe(false);
    });

    it('returns false for unknown tools', () => {
      expect(builder.isMutable('UnknownTool')).toBe(false);
    });
  });

  // ── build: Terminal category ──────────────────────────────────────────

  describe('build - terminal category', () => {
    it('renders command as code block', () => {
      const card = builder.build('Bash', { command: 'echo hello' });
      expect(card.header?.title).toBe('$ echo hello');
      expect(card.sections).toHaveLength(1);
      expect(card.sections[0]).toEqual({
        type: 'markdown',
        content: '```shell\necho hello\n```',
      });
    });

    it('includes output when result is provided', () => {
      const card = builder.build('Bash', { command: 'ls' }, 'file1\nfile2');
      expect(card.sections).toHaveLength(3); // command + divider + output
      expect(card.sections[0]!.type).toBe('markdown');
      expect(card.sections[1]!.type).toBe('divider');
      expect(card.sections[2]).toEqual({
        type: 'markdown',
        content: '```\nfile1\nfile2\n```',
      });
    });

    it('passes status to header', () => {
      const card = builder.build('Bash', { command: 'ls' }, undefined, 'running');
      expect(card.header?.status).toBe('running');
    });
  });

  // ── build: Diff category ──────────────────────────────────────────────

  describe('build - diff category', () => {
    it('renders old/new strings as diff', () => {
      const card = builder.build('Edit', {
        file_path: '/src/foo.ts',
        old_string: 'const a = 1;',
        new_string: 'const a = 2;',
      });
      expect(card.header?.subtitle).toBe('/src/foo.ts');
      expect(card.sections[0]).toEqual({
        type: 'markdown',
        content: '```diff\n- const a = 1;\n+ const a = 2;\n```',
      });
    });

    it('renders raw diff/patch content', () => {
      const card = builder.build('CodexPatch', {
        file_path: '/src/bar.ts',
        diff: '- old line\n+ new line',
      });
      expect(card.sections[0]).toEqual({
        type: 'markdown',
        content: '```diff\n- old line\n+ new line\n```',
      });
    });

    it('renders Write content as code block', () => {
      const card = builder.build('Write', {
        file_path: '/out.txt',
        content: 'file contents here',
      });
      expect(card.sections[0]).toEqual({
        type: 'markdown',
        content: '```\nfile contents here\n```',
      });
    });
  });

  // ── build: ReadOnly category ──────────────────────────────────────────

  describe('build - readonly category', () => {
    it('renders minimal card with header only', () => {
      const card = builder.build('Read', { file_path: '/src/index.ts' });
      expect(card.header?.title).toBe('Read /src/index.ts');
      expect(card.sections).toHaveLength(0);
    });

    it('includes subtitle from path/pattern', () => {
      const card = builder.build('Glob', { pattern: '**/*.ts' });
      expect(card.header?.subtitle).toBe('**/*.ts');
    });
  });

  // ── build: Interactive category ───────────────────────────────────────

  describe('build - interactive category', () => {
    it('renders question as markdown section', () => {
      const card = builder.build('AskUserQuestion', {
        question: 'Which approach do you prefer?',
      });
      expect(card.header?.title).toBe('Question');
      expect(card.sections).toHaveLength(1);
      expect(card.sections[0]).toEqual({
        type: 'markdown',
        content: 'Which approach do you prefer?',
      });
    });
  });

  // ── build: Meta category ──────────────────────────────────────────────

  describe('build - meta category', () => {
    it('renders TodoWrite tasks as checklist', () => {
      const card = builder.build('TodoWrite', {
        tasks: [
          { subject: 'Task 1', status: 'completed' },
          { subject: 'Task 2', status: 'pending' },
        ],
      });
      expect(card.sections[0]).toEqual({
        type: 'markdown',
        content: '- [x] Task 1\n- [ ] Task 2',
      });
    });

    it('renders Agent task with dynamic title', () => {
      const card = builder.build('Agent', { name: 'Research Agent' });
      expect(card.header?.title).toBe('Research Agent');
    });
  });

  // ── build: Unknown tool fallback ──────────────────────────────────────

  describe('build - unknown tool', () => {
    it('creates a generic card with input fields', () => {
      const card = builder.build('NewTool', { foo: 'bar', baz: 42 });
      expect(card.header?.title).toBe('NewTool');
      expect(card.sections[0]!.type).toBe('fields');
    });

    it('creates empty card for unknown tool with no input', () => {
      const card = builder.build('NewTool', {});
      expect(card.header?.title).toBe('NewTool');
      expect(card.sections).toHaveLength(1);
      expect(card.sections[0]!.type).toBe('note');
    });
  });

  // ── All tool names registered ─────────────────────────────────────────

  describe('all tool names registered', () => {
    const expectedTools = [
      'Bash', 'CodexBash', 'GeminiBash', 'shell', 'execute',
      'Edit', 'MultiEdit', 'edit', 'Write',
      'CodexPatch', 'CodexDiff', 'GeminiPatch', 'GeminiDiff',
      'Read', 'NotebookRead', 'Glob', 'Grep', 'search', 'LS',
      'WebFetch', 'WebSearch',
      'AskUserQuestion', 'ExitPlanMode',
      'TodoWrite', 'Task', 'Agent', 'NotebookEdit',
    ];

    for (const name of expectedTools) {
      it(`has "${name}" registered`, () => {
        expect(builder.has(name)).toBe(true);
      });
    }
  });
});
