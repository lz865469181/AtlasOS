import { describe, it, expect } from "vitest";
import {
  markdownCard, thinkingCard, errorCard,
  modelSelectionCard, permissionRequestCard,
  renderCardAsFeishuJSON,
} from "./cards.js";
import type { Card } from "../types.js";

describe("markdownCard", () => {
  it("creates a card with markdown content", () => {
    const json = markdownCard("Hello **world**");
    const card = JSON.parse(json);
    expect(card.config.wide_screen_mode).toBe(true);
    expect(card.elements).toHaveLength(1);
    expect(card.elements[0].tag).toBe("markdown");
    expect(card.elements[0].content).toBe("Hello **world**");
  });

  it("creates a card with title and divider", () => {
    const json = markdownCard("Body text", "Title");
    const card = JSON.parse(json);
    // title div + hr + markdown
    expect(card.elements).toHaveLength(3);
    expect(card.elements[0].tag).toBe("div");
    expect(card.elements[0].text.content).toBe("Title");
    expect(card.elements[1].tag).toBe("hr");
    expect(card.elements[2].tag).toBe("markdown");
  });
});

describe("thinkingCard", () => {
  it("returns a card with 'Thinking...' text", () => {
    const json = thinkingCard();
    const card = JSON.parse(json);
    expect(card.elements[0].content).toContain("Thinking");
  });
});

describe("errorCard", () => {
  it("returns a card with error message", () => {
    const json = errorCard("Something went wrong");
    const card = JSON.parse(json);
    expect(card.elements[0].content).toContain("Error");
    expect(card.elements[0].content).toContain("Something went wrong");
  });
});

describe("modelSelectionCard", () => {
  it("builds interactive model selection buttons", () => {
    const json = modelSelectionCard("claude-sonnet-4-20250514");
    const card = JSON.parse(json);

    expect(card.header.title.content).toBe("Select Model");
    expect(card.header.template).toBe("blue");

    // Find the action element
    const action = card.elements.find((e: any) => e.tag === "action");
    expect(action).toBeDefined();
    expect(action.actions.length).toBeGreaterThanOrEqual(3);

    // Current model button should be primary
    const currentBtn = action.actions.find((a: any) =>
      a.value.model === "claude-sonnet-4-20250514",
    );
    expect(currentBtn.type).toBe("primary");
    expect(currentBtn.text.content).toContain("(current)");

    // Other buttons should be default
    const otherBtn = action.actions.find((a: any) =>
      a.value.model === "claude-opus-4-20250514",
    );
    expect(otherBtn.type).toBe("default");
  });

  it("handles unknown current model gracefully", () => {
    const json = modelSelectionCard("unknown-model");
    const card = JSON.parse(json);
    // All buttons should be "default" type
    const action = card.elements.find((e: any) => e.tag === "action");
    for (const btn of action.actions) {
      expect(btn.type).toBe("default");
    }
  });
});

describe("permissionRequestCard", () => {
  it("builds a permission card with @mention and action buttons", () => {
    const json = permissionRequestCard({
      type: "doc",
      userOpenID: "ou_test123",
      resourceName: "Design Doc",
    });
    const card = JSON.parse(json);

    // Header
    expect(card.header.title.content).toContain("Document Access");
    expect(card.header.template).toBe("blue");

    // Markdown body should contain @mention
    const markdown = card.elements.find((e: any) => e.tag === "markdown");
    expect(markdown.content).toContain("<at id=ou_test123></at>");
    expect(markdown.content).toContain("Design Doc");

    // Action buttons
    const action = card.elements.find((e: any) => e.tag === "action");
    expect(action.actions).toHaveLength(2); // "I've Granted" + "Ignore" (no URL)
  });

  it("includes 'Open & Grant Access' button when resourceURL provided", () => {
    const json = permissionRequestCard({
      type: "wiki",
      userOpenID: "ou_test",
      resourceName: "KB",
      resourceURL: "https://example.com/doc",
    });
    const card = JSON.parse(json);
    const action = card.elements.find((e: any) => e.tag === "action");
    expect(action.actions).toHaveLength(3); // Open + Granted + Ignore
    expect(action.actions[0].url).toBe("https://example.com/doc");
    expect(action.actions[0].type).toBe("primary");
  });

  it("includes detail text when provided", () => {
    const json = permissionRequestCard({
      type: "app",
      userOpenID: "ou_test",
      resourceName: "API",
      detail: "Need read access to proceed",
    });
    const card = JSON.parse(json);
    const markdown = card.elements.find((e: any) => e.tag === "markdown");
    expect(markdown.content).toContain("Need read access to proceed");
  });

  it("supports all permission types", () => {
    for (const type of ["doc", "wiki", "app", "custom"] as const) {
      const json = permissionRequestCard({
        type,
        userOpenID: "ou_test",
        resourceName: "Resource",
      });
      const card = JSON.parse(json);
      expect(card.header).toBeDefined();
    }
  });
});

describe("renderCardAsFeishuJSON", () => {
  it("converts a platform-agnostic card to Feishu format", () => {
    const agnosticCard: Card = {
      header: { title: "Test", color: "green" },
      elements: [
        { type: "markdown", content: "Hello" },
        { type: "divider" },
        { type: "actions", buttons: [{ text: "OK", value: "ok", type: "primary" }] },
        { type: "note", content: "Footer" },
      ],
    };
    const json = renderCardAsFeishuJSON(agnosticCard);
    const card = JSON.parse(json);

    expect(card.config.wide_screen_mode).toBe(true);
    expect(card.header.title.content).toBe("Test");
    expect(card.header.template).toBe("green");

    expect(card.elements[0].tag).toBe("markdown");
    expect(card.elements[1].tag).toBe("hr");
    expect(card.elements[2].tag).toBe("action");
    expect(card.elements[2].actions[0].tag).toBe("button");
    expect(card.elements[2].actions[0].type).toBe("primary");
    expect(card.elements[3].tag).toBe("note");
  });

  it("handles list_item elements with extra button", () => {
    const agnosticCard: Card = {
      elements: [
        {
          type: "list_item",
          text: "Task 1",
          button: { text: "Delete", value: "del", type: "danger" },
        },
      ],
    };
    const json = renderCardAsFeishuJSON(agnosticCard);
    const card = JSON.parse(json);

    expect(card.elements[0].tag).toBe("div");
    expect(card.elements[0].text.tag).toBe("lark_md");
    expect(card.elements[0].extra.tag).toBe("button");
    expect(card.elements[0].extra.type).toBe("danger");
  });

  it("omits header when not provided", () => {
    const agnosticCard: Card = {
      elements: [{ type: "markdown", content: "No header" }],
    };
    const json = renderCardAsFeishuJSON(agnosticCard);
    const card = JSON.parse(json);
    expect(card.header).toBeUndefined();
  });
});
