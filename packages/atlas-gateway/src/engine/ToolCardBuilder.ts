import type { CardModel, CardSection } from '../cards/CardModel.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type ToolCategory = 'terminal' | 'diff' | 'readonly' | 'interactive' | 'meta';

export interface ToolCardMeta {
  title: string | ((input: Record<string, unknown>) => string);
  icon: string;
  category: ToolCategory;
  isMutable: boolean;
  minimal: boolean;
  hidden: boolean;
  buildCard(input: Record<string, unknown>, result?: unknown, status?: string): CardModel;
}

export interface ToolCardBuilder {
  register(toolName: string, meta: ToolCardMeta): void;
  has(toolName: string): boolean;
  build(toolName: string, input: Record<string, unknown>, result?: unknown, status?: string): CardModel;
  getTitle(toolName: string, input: Record<string, unknown>): string;
  isHidden(toolName: string): boolean;
  isMutable(toolName: string): boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '...';
}

function str(val: unknown): string {
  if (typeof val === 'string') return val;
  if (val === undefined || val === null) return '';
  return String(val);
}

function statusFromString(status?: string): 'running' | 'done' | 'error' | 'waiting' | undefined {
  if (status === 'running' || status === 'done' || status === 'error' || status === 'waiting') {
    return status;
  }
  return undefined;
}

// ── Category builders ────────────────────────────────────────────────────────

function buildTerminalCard(
  title: string,
  icon: string,
  input: Record<string, unknown>,
  result?: unknown,
  status?: string,
): CardModel {
  const command = str(input['command'] || input['cmd'] || input['script'] || '');
  const sections: CardSection[] = [];

  if (command) {
    sections.push({ type: 'markdown', content: '```shell\n' + command + '\n```' });
  }

  if (result !== undefined && result !== null) {
    const output = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    if (output) {
      sections.push({ type: 'divider' });
      sections.push({ type: 'markdown', content: '```\n' + truncate(output, 2000) + '\n```' });
    }
  }

  if (sections.length === 0) {
    sections.push({ type: 'note', content: 'No command provided' });
  }

  return {
    header: { title, icon, status: statusFromString(status) },
    sections,
  };
}

function buildDiffCard(
  title: string,
  icon: string,
  input: Record<string, unknown>,
  result?: unknown,
  status?: string,
): CardModel {
  const filePath = str(input['file_path'] || input['filePath'] || input['path'] || '');
  const sections: CardSection[] = [];

  // Gather diff content from various tool input shapes
  const oldStr = str(input['old_string'] || input['old_str'] || '');
  const newStr = str(input['new_string'] || input['new_str'] || '');
  const content = str(input['content'] || '');
  const diff = str(input['diff'] || input['patch'] || '');

  if (diff) {
    sections.push({ type: 'markdown', content: '```diff\n' + diff + '\n```' });
  } else if (oldStr || newStr) {
    let diffText = '';
    if (oldStr) {
      for (const line of oldStr.split('\n')) {
        diffText += '- ' + line + '\n';
      }
    }
    if (newStr) {
      for (const line of newStr.split('\n')) {
        diffText += '+ ' + line + '\n';
      }
    }
    sections.push({ type: 'markdown', content: '```diff\n' + diffText.trimEnd() + '\n```' });
  } else if (content) {
    sections.push({ type: 'markdown', content: '```\n' + truncate(content, 2000) + '\n```' });
  }

  if (result !== undefined && result !== null) {
    const output = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    if (output) {
      sections.push({ type: 'note', content: truncate(output, 500) });
    }
  }

  if (sections.length === 0) {
    sections.push({ type: 'note', content: filePath || 'No diff content' });
  }

  return {
    header: {
      title,
      subtitle: filePath || undefined,
      icon,
      status: statusFromString(status),
    },
    sections,
  };
}

function buildReadOnlyCard(
  title: string,
  icon: string,
  input: Record<string, unknown>,
  _result?: unknown,
  status?: string,
): CardModel {
  const filePath = str(
    input['file_path'] || input['filePath'] || input['path'] ||
    input['pattern'] || input['query'] || input['url'] || '',
  );

  return {
    header: {
      title,
      subtitle: filePath || undefined,
      icon,
      status: statusFromString(status),
    },
    sections: [],
  };
}

function buildInteractiveCard(
  title: string,
  icon: string,
  input: Record<string, unknown>,
  _result?: unknown,
  status?: string,
): CardModel {
  const description = str(input['question'] || input['description'] || input['message'] || '');
  const sections: CardSection[] = [];

  if (description) {
    sections.push({ type: 'markdown', content: description });
  }

  return {
    header: { title, icon, status: statusFromString(status) },
    sections,
  };
}

function buildMetaCard(
  title: string,
  icon: string,
  input: Record<string, unknown>,
  _result?: unknown,
  status?: string,
): CardModel {
  const sections: CardSection[] = [];

  // Handle TodoWrite-style tasks array
  const tasks = input['tasks'] as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(tasks)) {
    const lines = tasks.map((t) => {
      const check = t['status'] === 'completed' ? '[x]' : '[ ]';
      return `- ${check} ${str(t['content'] || t['subject'] || t['title'] || '')}`;
    });
    sections.push({ type: 'markdown', content: lines.join('\n') });
  }

  // Handle summary/description
  const description = str(input['description'] || input['summary'] || '');
  if (description) {
    sections.push({ type: 'markdown', content: description });
  }

  if (sections.length === 0) {
    sections.push({ type: 'note', content: 'No content' });
  }

  return {
    header: { title, icon, status: statusFromString(status) },
    sections,
  };
}

// ── Default card for unknown tools ───────────────────────────────────────────

function buildUnknownCard(
  toolName: string,
  input: Record<string, unknown>,
  result?: unknown,
  status?: string,
): CardModel {
  const sections: CardSection[] = [];

  const keys = Object.keys(input);
  if (keys.length > 0) {
    const fields = keys.slice(0, 5).map((k) => ({
      label: k,
      value: truncate(str(input[k]), 100),
      short: true,
    }));
    sections.push({ type: 'fields', fields });
  }

  if (result !== undefined && result !== null) {
    const output = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    sections.push({ type: 'note', content: truncate(output, 500) });
  }

  if (sections.length === 0) {
    sections.push({ type: 'note', content: 'No details available' });
  }

  return {
    header: {
      title: toolName,
      icon: '\u{2753}', // question mark
      status: statusFromString(status),
    },
    sections,
  };
}

// ── Registry & all known tools ───────────────────────────────────────────────

type TitleFn = (input: Record<string, unknown>) => string;

function terminalTitle(input: Record<string, unknown>): string {
  const cmd = str(input['command'] || input['cmd'] || input['script'] || '');
  return cmd ? '$ ' + truncate(cmd, 60) : '$ (empty)';
}

const KNOWN_TOOLS: Array<{ names: string[]; meta: ToolCardMeta }> = [
  // ── Terminal ───────────────────────────────────────────────────────────
  {
    names: ['Bash', 'CodexBash', 'GeminiBash', 'shell', 'execute'],
    meta: {
      title: terminalTitle as TitleFn,
      icon: '\u{1F4BB}', // laptop
      category: 'terminal',
      isMutable: true,
      minimal: false,
      hidden: false,
      buildCard(input, result, status) {
        const title = terminalTitle(input);
        return buildTerminalCard(title, this.icon, input, result, status);
      },
    },
  },

  // ── Diff ───────────────────────────────────────────────────────────────
  {
    names: ['Edit', 'MultiEdit', 'edit'],
    meta: {
      title: ((input: Record<string, unknown>) =>
        'Edit ' + str(input['file_path'] || input['filePath'] || input['path'] || '')) as TitleFn,
      icon: '\u{270F}\u{FE0F}', // pencil
      category: 'diff',
      isMutable: true,
      minimal: false,
      hidden: false,
      buildCard(input, result, status) {
        const title = typeof this.title === 'function' ? this.title(input) : this.title;
        return buildDiffCard(title, this.icon, input, result, status);
      },
    },
  },
  {
    names: ['Write'],
    meta: {
      title: ((input: Record<string, unknown>) =>
        'Write ' + str(input['file_path'] || input['filePath'] || input['path'] || '')) as TitleFn,
      icon: '\u{1F4DD}', // memo
      category: 'diff',
      isMutable: true,
      minimal: false,
      hidden: false,
      buildCard(input, result, status) {
        const title = typeof this.title === 'function' ? this.title(input) : this.title;
        return buildDiffCard(title, this.icon, input, result, status);
      },
    },
  },
  {
    names: ['CodexPatch', 'CodexDiff', 'GeminiPatch', 'GeminiDiff'],
    meta: {
      title: ((input: Record<string, unknown>) =>
        'Patch ' + str(input['file_path'] || input['filePath'] || input['path'] || '')) as TitleFn,
      icon: '\u{1F529}', // wrench
      category: 'diff',
      isMutable: true,
      minimal: false,
      hidden: false,
      buildCard(input, result, status) {
        const title = typeof this.title === 'function' ? this.title(input) : this.title;
        return buildDiffCard(title, this.icon, input, result, status);
      },
    },
  },

  // ── ReadOnly ───────────────────────────────────────────────────────────
  {
    names: ['Read', 'NotebookRead'],
    meta: {
      title: ((input: Record<string, unknown>) =>
        'Read ' + str(input['file_path'] || input['filePath'] || input['path'] || '')) as TitleFn,
      icon: '\u{1F4C4}', // page_facing_up
      category: 'readonly',
      isMutable: false,
      minimal: true,
      hidden: false,
      buildCard(input, result, status) {
        const title = typeof this.title === 'function' ? this.title(input) : this.title;
        return buildReadOnlyCard(title, this.icon, input, result, status);
      },
    },
  },
  {
    names: ['Glob'],
    meta: {
      title: ((input: Record<string, unknown>) =>
        'Search ' + str(input['pattern'] || '')) as TitleFn,
      icon: '\u{1F50D}', // magnifying glass
      category: 'readonly',
      isMutable: false,
      minimal: true,
      hidden: false,
      buildCard(input, result, status) {
        const title = typeof this.title === 'function' ? this.title(input) : this.title;
        return buildReadOnlyCard(title, this.icon, input, result, status);
      },
    },
  },
  {
    names: ['Grep', 'search'],
    meta: {
      title: ((input: Record<string, unknown>) =>
        'Grep ' + str(input['pattern'] || input['query'] || '')) as TitleFn,
      icon: '\u{1F50E}', // magnifying glass tilted right
      category: 'readonly',
      isMutable: false,
      minimal: true,
      hidden: false,
      buildCard(input, result, status) {
        const title = typeof this.title === 'function' ? this.title(input) : this.title;
        return buildReadOnlyCard(title, this.icon, input, result, status);
      },
    },
  },
  {
    names: ['LS'],
    meta: {
      title: ((input: Record<string, unknown>) =>
        'List ' + str(input['path'] || '')) as TitleFn,
      icon: '\u{1F4C2}', // open_file_folder
      category: 'readonly',
      isMutable: false,
      minimal: true,
      hidden: false,
      buildCard(input, result, status) {
        const title = typeof this.title === 'function' ? this.title(input) : this.title;
        return buildReadOnlyCard(title, this.icon, input, result, status);
      },
    },
  },
  {
    names: ['WebFetch'],
    meta: {
      title: ((input: Record<string, unknown>) =>
        'Fetch ' + truncate(str(input['url'] || ''), 50)) as TitleFn,
      icon: '\u{1F310}', // globe
      category: 'readonly',
      isMutable: false,
      minimal: true,
      hidden: false,
      buildCard(input, result, status) {
        const title = typeof this.title === 'function' ? this.title(input) : this.title;
        return buildReadOnlyCard(title, this.icon, input, result, status);
      },
    },
  },
  {
    names: ['WebSearch'],
    meta: {
      title: ((input: Record<string, unknown>) =>
        'Search: ' + str(input['query'] || '')) as TitleFn,
      icon: '\u{1F50D}', // magnifying glass
      category: 'readonly',
      isMutable: false,
      minimal: true,
      hidden: false,
      buildCard(input, result, status) {
        const title = typeof this.title === 'function' ? this.title(input) : this.title;
        return buildReadOnlyCard(title, this.icon, input, result, status);
      },
    },
  },

  // ── Interactive ────────────────────────────────────────────────────────
  {
    names: ['AskUserQuestion'],
    meta: {
      title: 'Question',
      icon: '\u{2753}', // question mark
      category: 'interactive',
      isMutable: false,
      minimal: false,
      hidden: false,
      buildCard(input, result, status) {
        return buildInteractiveCard('Question', this.icon, input, result, status);
      },
    },
  },
  {
    names: ['ExitPlanMode'],
    meta: {
      title: 'Exit Plan Mode',
      icon: '\u{1F6AA}', // door
      category: 'interactive',
      isMutable: false,
      minimal: false,
      hidden: false,
      buildCard(input, result, status) {
        return buildInteractiveCard('Exit Plan Mode', this.icon, input, result, status);
      },
    },
  },

  // ── Meta ───────────────────────────────────────────────────────────────
  {
    names: ['TodoWrite'],
    meta: {
      title: 'Update Tasks',
      icon: '\u{2705}', // check mark
      category: 'meta',
      isMutable: true,
      minimal: false,
      hidden: false,
      buildCard(input, result, status) {
        return buildMetaCard('Update Tasks', this.icon, input, result, status);
      },
    },
  },
  {
    names: ['Task', 'Agent'],
    meta: {
      title: ((input: Record<string, unknown>) =>
        str(input['title'] || input['name'] || 'Agent Task')) as TitleFn,
      icon: '\u{1F916}', // robot
      category: 'meta',
      isMutable: true,
      minimal: false,
      hidden: false,
      buildCard(input, result, status) {
        const title = typeof this.title === 'function' ? this.title(input) : this.title;
        return buildMetaCard(title, this.icon, input, result, status);
      },
    },
  },
  {
    names: ['NotebookEdit'],
    meta: {
      title: ((input: Record<string, unknown>) =>
        'Notebook Edit ' + str(input['notebook_path'] || input['path'] || '')) as TitleFn,
      icon: '\u{1F4D3}', // notebook
      category: 'meta',
      isMutable: true,
      minimal: false,
      hidden: false,
      buildCard(input, result, status) {
        const title = typeof this.title === 'function' ? this.title(input) : this.title;
        return buildMetaCard(title, this.icon, input, result, status);
      },
    },
  },
];

// ── Implementation ───────────────────────────────────────────────────────────

export class ToolCardBuilderImpl implements ToolCardBuilder {
  private registry = new Map<string, ToolCardMeta>();

  constructor() {
    // Register all known tools
    for (const entry of KNOWN_TOOLS) {
      for (const name of entry.names) {
        this.register(name, entry.meta);
      }
    }
  }

  register(toolName: string, meta: ToolCardMeta): void {
    this.registry.set(toolName, meta);
  }

  has(toolName: string): boolean {
    return this.registry.has(toolName);
  }

  build(
    toolName: string,
    input: Record<string, unknown>,
    result?: unknown,
    status?: string,
  ): CardModel {
    const meta = this.registry.get(toolName);
    if (!meta) {
      return buildUnknownCard(toolName, input, result, status);
    }
    return meta.buildCard(input, result, status);
  }

  getTitle(toolName: string, input: Record<string, unknown>): string {
    const meta = this.registry.get(toolName);
    if (!meta) return toolName;
    if (typeof meta.title === 'function') {
      return meta.title(input);
    }
    return meta.title;
  }

  isHidden(toolName: string): boolean {
    const meta = this.registry.get(toolName);
    return meta?.hidden ?? false;
  }

  isMutable(toolName: string): boolean {
    const meta = this.registry.get(toolName);
    return meta?.isMutable ?? false;
  }
}
