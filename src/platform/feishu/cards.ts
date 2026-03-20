import { AVAILABLE_MODELS } from "../../session/session.js";

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
