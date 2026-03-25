import type { Card, CardButton, CardElement, CardHeaderColor } from "../types.js";

// Model labels — previously imported from session/session.ts which is now deleted.
// In the new architecture, models are managed by agents via ModelSwitcher interface.
const AVAILABLE_MODELS: Record<string, string> = {
  "claude-sonnet-4-20250514": "Claude Sonnet 4",
  "claude-haiku-4-20250414": "Claude Haiku 4",
  "claude-opus-4-20250514": "Claude Opus 4",
};

/** Permission types the bot may need to request from a user. */
export type PermissionType = "doc" | "wiki" | "app" | "custom";

interface PermissionCardOptions {
  /** What kind of permission is needed */
  type: PermissionType;
  /** The user open_id to @mention in the card */
  userOpenID: string;
  /** Human-readable resource name, e.g. "Q3 OKR doc" */
  resourceName: string;
  /** URL the user can click to grant / open the resource (optional) */
  resourceURL?: string;
  /** Extra description shown below the title (optional) */
  detail?: string;
}

const PERMISSION_META: Record<PermissionType, { icon: string; label: string; color: string }> = {
  doc:   { icon: "📄", label: "Document Access",       color: "blue"   },
  wiki:  { icon: "📚", label: "Knowledge Base Access",  color: "green"  },
  app:   { icon: "🔑", label: "App Permission",         color: "orange" },
  custom:{ icon: "⚙️", label: "Permission Required",    color: "purple" },
};

/**
 * Build an interactive card that requests a specific permission from a user.
 *
 * Usage:
 *   const card = permissionRequestCard({ type: "doc", userOpenID: "ou_xxx", resourceName: "设计文档" });
 *   await sender.sendInteractiveCard(chatID, card, messageID);
 */
export function permissionRequestCard(opts: PermissionCardOptions): string {
  const meta = PERMISSION_META[opts.type];

  // Markdown body with @mention
  const mentionTag = `<at id=${opts.userOpenID}></at>`;
  let body = `${meta.icon} **${meta.label}**\n\nHi ${mentionTag}, I need access to **${opts.resourceName}** to continue.`;
  if (opts.detail) {
    body += `\n\n${opts.detail}`;
  }

  const actions: unknown[] = [];

  // "Open Resource" button (if URL provided)
  if (opts.resourceURL) {
    actions.push({
      tag: "button",
      text: { tag: "plain_text", content: "Open & Grant Access" },
      type: "primary",
      url: opts.resourceURL,
    });
  }

  // "I've Granted" callback button
  actions.push({
    tag: "button",
    text: { tag: "plain_text", content: "I've Granted ✅" },
    type: "default",
    value: { action: "permission_granted", permission_type: opts.type, resource: opts.resourceName },
  });

  // "Ignore" button
  actions.push({
    tag: "button",
    text: { tag: "plain_text", content: "Ignore" },
    type: "default",
    value: { action: "permission_ignored", permission_type: opts.type, resource: opts.resourceName },
  });

  const card = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: `${meta.icon} ${meta.label}` },
      template: meta.color,
    },
    elements: [
      { tag: "markdown", content: body },
      { tag: "hr" },
      { tag: "action", actions },
      {
        tag: "note",
        elements: [
          { tag: "plain_text", content: "Please grant the requested permission, then click \"I've Granted\"." },
        ],
      },
    ],
  };

  return JSON.stringify(card);
}

/**
 * Build a Feishu interactive card with markdown content.
 */
export function markdownCard(content: string, title?: string): string {
  const elements: unknown[] = [];

  if (title) {
    elements.push({
      tag: "div",
      text: { tag: "plain_text", content: title },
    });
    elements.push({ tag: "hr" });
  }

  elements.push({
    tag: "markdown",
    content,
  });

  return JSON.stringify({
    config: { wide_screen_mode: true },
    elements,
  });
}

/**
 * Build a "thinking" card shown while processing.
 */
export function thinkingCard(): string {
  return markdownCard("*Thinking...*");
}

/**
 * Build an error card.
 */
export function errorCard(message: string): string {
  return markdownCard(`**Error:** ${message}`);
}

/**
 * Build an interactive model selection card.
 * Uses Feishu card button actions so the user can tap to select a model.
 */
export function modelSelectionCard(currentModel: string): string {
  const buttons = Object.entries(AVAILABLE_MODELS).map(([modelId, label]) => {
    const isCurrent = modelId === currentModel;
    return {
      tag: "button",
      text: {
        tag: "plain_text",
        content: isCurrent ? `${label} (current)` : label,
      },
      type: isCurrent ? "primary" : "default",
      value: { action: "select_model", model: modelId },
    };
  });

  const card = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: "Select Model" },
      template: "blue",
    },
    elements: [
      {
        tag: "markdown",
        content: `Current model: **${AVAILABLE_MODELS[currentModel] ?? currentModel}**\n\nChoose a model for this session:`,
      },
      { tag: "hr" },
      {
        tag: "action",
        actions: buttons,
      },
      {
        tag: "note",
        elements: [
          {
            tag: "plain_text",
            content: "Haiku = fast & cheap | Sonnet = balanced | Opus = most capable",
          },
        ],
      },
    ],
  };

  return JSON.stringify(card);
}

/**
 * Convert a platform-agnostic Card into Feishu Interactive Card JSON.
 * This bridges the platform-agnostic Card model to Feishu's card format.
 */
export function renderCardAsFeishuJSON(agnosticCard: Card): string {
  const COLOR_MAP: Record<string, string> = {
    blue: "blue", green: "green", orange: "orange",
    red: "red", purple: "purple", grey: "grey",
  };

  const elements: unknown[] = [];

  for (const el of agnosticCard.elements) {
    switch (el.type) {
      case "markdown":
        elements.push({ tag: "markdown", content: el.content });
        break;
      case "divider":
        elements.push({ tag: "hr" });
        break;
      case "actions":
        elements.push({
          tag: "action",
          actions: el.buttons.map((b) => ({
            tag: "button",
            text: { tag: "plain_text", content: b.text },
            type: b.type === "danger" ? "danger" : b.type === "primary" ? "primary" : "default",
            value: { action: b.value, ...(b.extra ?? {}) },
          })),
        });
        break;
      case "note":
        elements.push({
          tag: "note",
          elements: [{ tag: "plain_text", content: el.content }],
        });
        break;
      case "list_item": {
        const extra = el.button ? {
          tag: "button",
          text: { tag: "plain_text", content: el.button.text },
          type: el.button.type === "danger" ? "danger" : el.button.type === "primary" ? "primary" : "default",
          value: { action: el.button.value, ...(el.button.extra ?? {}) },
        } : undefined;
        elements.push({
          tag: "div",
          text: { tag: "lark_md", content: el.text },
          ...(extra ? { extra } : {}),
        });
        break;
      }
    }
  }

  const feishuCard: Record<string, unknown> = {
    config: { wide_screen_mode: true },
    elements,
  };

  if (agnosticCard.header) {
    feishuCard.header = {
      title: { tag: "plain_text", content: agnosticCard.header.title },
      template: COLOR_MAP[agnosticCard.header.color ?? "blue"] ?? "blue",
    };
  }

  return JSON.stringify(feishuCard);
}
