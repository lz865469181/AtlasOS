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
