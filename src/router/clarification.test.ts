import { describe, it, expect } from "vitest";
import { parseClarification, stripClarification, buildClarificationCard } from "./clarification.js";

describe("parseClarification", () => {
  it("parses a full clarification block", () => {
    const text = `Here is some context.

[CLARIFICATION_NEEDED]
type: approach_choice
question: Should we use REST or GraphQL for the API?
context: Both are viable for this use case
options: REST API | GraphQL | gRPC
[/CLARIFICATION_NEEDED]

Let me know what you prefer.`;

    const result = parseClarification(text);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("approach_choice");
    expect(result!.question).toBe("Should we use REST or GraphQL for the API?");
    expect(result!.context).toBe("Both are viable for this use case");
    expect(result!.options).toEqual(["REST API", "GraphQL", "gRPC"]);
  });

  it("parses minimal clarification (question only)", () => {
    const text = `[CLARIFICATION_NEEDED]
type: missing_info
question: What database are you using?
[/CLARIFICATION_NEEDED]`;

    const result = parseClarification(text);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("missing_info");
    expect(result!.question).toBe("What database are you using?");
    expect(result!.context).toBeUndefined();
    expect(result!.options).toBeUndefined();
  });

  it("returns null for text without clarification block", () => {
    expect(parseClarification("Just a normal response")).toBeNull();
  });

  it("returns null if question is missing", () => {
    const text = `[CLARIFICATION_NEEDED]
type: missing_info
[/CLARIFICATION_NEEDED]`;
    expect(parseClarification(text)).toBeNull();
  });

  it("defaults type to missing_info when not specified", () => {
    const text = `[CLARIFICATION_NEEDED]
question: What do you mean?
[/CLARIFICATION_NEEDED]`;
    const result = parseClarification(text);
    expect(result!.type).toBe("missing_info");
  });
});

describe("stripClarification", () => {
  it("removes the clarification block", () => {
    const text = `Before.

[CLARIFICATION_NEEDED]
type: missing_info
question: What?
[/CLARIFICATION_NEEDED]

After.`;

    expect(stripClarification(text)).toBe("Before.\n\n\n\nAfter.");
  });

  it("returns original text if no block", () => {
    expect(stripClarification("no block here")).toBe("no block here");
  });
});

describe("buildClarificationCard", () => {
  it("builds a valid card JSON with options", () => {
    const card = buildClarificationCard({
      type: "approach_choice",
      question: "REST or GraphQL?",
      options: ["REST", "GraphQL"],
    }, "session-123");

    const parsed = JSON.parse(card);
    expect(parsed.header.template).toBe("green");
    expect(parsed.elements).toHaveLength(4); // markdown, hr, action, note

    const actions = parsed.elements[2].actions;
    // 2 options + 1 skip button
    expect(actions).toHaveLength(3);
    expect(actions[0].value.action).toBe("clarification_reply");
    expect(actions[0].value.reply).toBe("REST");
    expect(actions[2].value.action).toBe("clarification_skip");
  });

  it("builds card without options (skip button only)", () => {
    const card = buildClarificationCard({
      type: "missing_info",
      question: "What database?",
    }, "session-456");

    const parsed = JSON.parse(card);
    const actions = parsed.elements[2].actions;
    expect(actions).toHaveLength(1); // only skip
  });
});
