import { describe, it, expect } from "vitest";
import { CardBuilder, renderCardAsText, collectCardButtons } from "./cards.js";
import type { Card } from "./cards.js";

describe("CardBuilder", () => {
  it("builds a card with header", () => {
    const card = new CardBuilder().title("Hello", "blue").build();
    expect(card.header).toEqual({ title: "Hello", color: "blue" });
  });

  it("builds a card with markdown element", () => {
    const card = new CardBuilder().markdown("**bold**").build();
    expect(card.elements).toHaveLength(1);
    expect(card.elements[0]).toEqual({ type: "markdown", content: "**bold**" });
  });

  it("supports fluent chaining", () => {
    const card = new CardBuilder()
      .title("Test")
      .markdown("content")
      .divider()
      .note("footnote")
      .build();
    expect(card.header?.title).toBe("Test");
    expect(card.elements).toHaveLength(3);
    expect(card.elements[0]!.type).toBe("markdown");
    expect(card.elements[1]!.type).toBe("divider");
    expect(card.elements[2]!.type).toBe("note");
  });

  it("builds cards with buttons", () => {
    const card = new CardBuilder()
      .buttons([
        { text: "OK", value: "ok", type: "primary" },
        { text: "Cancel", value: "cancel", type: "danger" },
      ])
      .build();
    const actions = card.elements[0];
    expect(actions!.type).toBe("actions");
    if (actions!.type === "actions") {
      expect(actions.buttons).toHaveLength(2);
      expect(actions.buttons[0]!.text).toBe("OK");
    }
  });

  it("builds cards with list items and buttons", () => {
    const card = new CardBuilder()
      .listItem("Item 1", { text: "Delete", value: "del-1", type: "danger" })
      .listItem("Item 2")
      .build();
    expect(card.elements).toHaveLength(2);
    expect(card.elements[0]!.type).toBe("list_item");
  });
});

describe("renderCardAsText", () => {
  it("renders header as bold", () => {
    const card: Card = { header: { title: "Title" }, elements: [] };
    expect(renderCardAsText(card)).toBe("**Title**");
  });

  it("renders all element types", () => {
    const card = new CardBuilder()
      .title("Test")
      .markdown("hello")
      .divider()
      .buttons([{ text: "OK", value: "ok" }])
      .note("info")
      .listItem("task", { text: "Do", value: "do" })
      .build();

    const text = renderCardAsText(card);
    expect(text).toContain("**Test**");
    expect(text).toContain("hello");
    expect(text).toContain("───");
    expect(text).toContain("[OK]");
    expect(text).toContain("> info");
    expect(text).toContain("• task [Do]");
  });

  it("renders card without header", () => {
    const card: Card = {
      elements: [{ type: "markdown", content: "just text" }],
    };
    expect(renderCardAsText(card)).toBe("just text");
  });
});

describe("collectCardButtons", () => {
  it("collects buttons from actions elements", () => {
    const card = new CardBuilder()
      .buttons([
        { text: "A", value: "a" },
        { text: "B", value: "b" },
      ])
      .build();
    const buttons = collectCardButtons(card);
    expect(buttons).toHaveLength(2);
    expect(buttons.map((b) => b.value)).toEqual(["a", "b"]);
  });

  it("collects buttons from list_item elements", () => {
    const card = new CardBuilder()
      .listItem("Item", { text: "Click", value: "click" })
      .listItem("No button")
      .build();
    const buttons = collectCardButtons(card);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.value).toBe("click");
  });

  it("returns empty array for cards without buttons", () => {
    const card = new CardBuilder().markdown("text").divider().build();
    expect(collectCardButtons(card)).toEqual([]);
  });
});
