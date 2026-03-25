export type CardHeaderColor = "blue" | "green" | "orange" | "red" | "purple" | "grey";

export interface CardHeader {
  title: string;
  color?: CardHeaderColor;
}

export interface CardButton {
  text: string;
  value: string;
  type?: "primary" | "default" | "danger";
  extra?: Record<string, unknown>;
}

export type CardElement =
  | { type: "markdown"; content: string }
  | { type: "divider" }
  | { type: "actions"; buttons: CardButton[] }
  | { type: "note"; content: string }
  | { type: "list_item"; text: string; button?: CardButton };

export interface Card {
  header?: CardHeader;
  elements: CardElement[];
}

/** Fluent card builder. */
export class CardBuilder {
  private header?: CardHeader;
  private elements: CardElement[] = [];

  title(text: string, color?: CardHeaderColor): this {
    this.header = { title: text, color };
    return this;
  }

  markdown(content: string): this {
    this.elements.push({ type: "markdown", content });
    return this;
  }

  divider(): this {
    this.elements.push({ type: "divider" });
    return this;
  }

  buttons(buttons: CardButton[]): this {
    this.elements.push({ type: "actions", buttons });
    return this;
  }

  note(content: string): this {
    this.elements.push({ type: "note", content });
    return this;
  }

  listItem(text: string, button?: CardButton): this {
    this.elements.push({ type: "list_item", text, button });
    return this;
  }

  build(): Card {
    return { header: this.header, elements: this.elements };
  }
}

/** Render a card to plain text (fallback for platforms without card support). */
export function renderCardAsText(card: Card): string {
  const lines: string[] = [];
  if (card.header) lines.push(`**${card.header.title}**`);
  for (const el of card.elements) {
    switch (el.type) {
      case "markdown":
        lines.push(el.content);
        break;
      case "divider":
        lines.push("───");
        break;
      case "actions":
        lines.push(el.buttons.map((b) => `[${b.text}]`).join("  "));
        break;
      case "note":
        lines.push(`> ${el.content}`);
        break;
      case "list_item":
        lines.push(`• ${el.text}${el.button ? ` [${el.button.text}]` : ""}`);
        break;
    }
  }
  return lines.join("\n");
}

/** Extract all buttons from a card (for InlineButtonSender). */
export function collectCardButtons(card: Card): CardButton[] {
  const buttons: CardButton[] = [];
  for (const el of card.elements) {
    if (el.type === "actions") buttons.push(...el.buttons);
    if (el.type === "list_item" && el.button) buttons.push(el.button);
  }
  return buttons;
}
