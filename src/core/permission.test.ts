import { describe, it, expect, vi } from "vitest";
import {
  isAllowResponse, isDenyResponse, isApproveAllResponse,
  buildPermissionCard,
} from "./permission.js";

describe("isAllowResponse", () => {
  it.each(["y", "yes", "allow", "ok", "是", "允许", "同意", "好"])(
    "recognizes '%s' as allow",
    (input) => {
      expect(isAllowResponse(input)).toBe(true);
    },
  );

  it("is case insensitive", () => {
    expect(isAllowResponse("YES")).toBe(true);
    expect(isAllowResponse("Allow")).toBe(true);
  });

  it("trims whitespace", () => {
    expect(isAllowResponse("  yes  ")).toBe(true);
  });

  it("rejects non-allow responses", () => {
    expect(isAllowResponse("no")).toBe(false);
    expect(isAllowResponse("maybe")).toBe(false);
  });
});

describe("isDenyResponse", () => {
  it.each(["n", "no", "deny", "reject", "否", "拒绝", "不"])(
    "recognizes '%s' as deny",
    (input) => {
      expect(isDenyResponse(input)).toBe(true);
    },
  );

  it("is case insensitive", () => {
    expect(isDenyResponse("NO")).toBe(true);
    expect(isDenyResponse("Deny")).toBe(true);
  });

  it("rejects non-deny responses", () => {
    expect(isDenyResponse("yes")).toBe(false);
  });
});

describe("isApproveAllResponse", () => {
  it.each(["yesall", "yes all", "allow all", "全部允许", "always"])(
    "recognizes '%s' as approve-all",
    (input) => {
      expect(isApproveAllResponse(input)).toBe(true);
    },
  );

  it("is case insensitive", () => {
    expect(isApproveAllResponse("YES ALL")).toBe(true);
    expect(isApproveAllResponse("Always")).toBe(true);
  });

  it("rejects plain allow/deny", () => {
    expect(isApproveAllResponse("yes")).toBe(false);
    expect(isApproveAllResponse("no")).toBe(false);
  });
});

describe("buildPermissionCard", () => {
  it("builds a card with tool info and buttons", () => {
    const card = buildPermissionCard("bash", "rm -rf /tmp/test");
    expect(card.header?.title).toBe("Permission Request");
    expect(card.header?.color).toBe("orange");

    // Should contain markdown with tool name and input
    const markdown = card.elements.find((e) => e.type === "markdown");
    expect(markdown).toBeDefined();
    if (markdown?.type === "markdown") {
      expect(markdown.content).toContain("bash");
      expect(markdown.content).toContain("rm -rf /tmp/test");
    }

    // Should have Allow/Deny/Allow All buttons
    const actions = card.elements.find((e) => e.type === "actions");
    expect(actions).toBeDefined();
    if (actions?.type === "actions") {
      expect(actions.buttons).toHaveLength(3);
      expect(actions.buttons.map((b) => b.value)).toEqual([
        "perm:allow", "perm:deny", "perm:allow_all",
      ]);
    }
  });

  it("builds a card with questions instead of buttons", () => {
    const card = buildPermissionCard("ask", "Choose option", [
      { question: "Which server?", options: ["prod", "staging"] },
    ]);

    // Should not have action buttons
    const actions = card.elements.find((e) => e.type === "actions");
    expect(actions).toBeUndefined();

    // Should have list items for options
    const listItems = card.elements.filter((e) => e.type === "list_item");
    expect(listItems.length).toBe(2);

    // Should have note about replying
    const note = card.elements.find((e) => e.type === "note");
    expect(note).toBeDefined();
  });

  it("truncates long input in card", () => {
    const longInput = "x".repeat(1000);
    const card = buildPermissionCard("tool", longInput);
    const markdown = card.elements.find((e) => e.type === "markdown");
    if (markdown?.type === "markdown") {
      // Input should be truncated to 500 chars
      expect(markdown.content.length).toBeLessThan(1000);
    }
  });
});
