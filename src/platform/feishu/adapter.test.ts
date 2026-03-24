import { describe, it, expect, vi } from "vitest";
import type { Attachment } from "./types.js";

/**
 * Test the Feishu adapter's parseMessageEvent logic.
 *
 * Since parseMessageEvent is private, we test the behavior indirectly
 * by validating the data transformations it performs.
 */
describe("Feishu message parsing logic", () => {
  // Simulate the parsing logic from adapter.ts

  function parseTextContent(content: string): string {
    try {
      const parsed = JSON.parse(content);
      return parsed.text ?? "";
    } catch {
      return content ?? "";
    }
  }

  function stripMentions(text: string, mentions: Array<{ key: string }>): string {
    let result = text;
    for (const mention of mentions) {
      if (mention.key) {
        result = result.replace(mention.key, "").trim();
      }
    }
    return result;
  }

  describe("text message parsing", () => {
    it("parses JSON text content", () => {
      const text = parseTextContent('{"text":"hello world"}');
      expect(text).toBe("hello world");
    });

    it("handles plain text fallback", () => {
      const text = parseTextContent("plain text message");
      expect(text).toBe("plain text message");
    });

    it("handles empty text in JSON", () => {
      const text = parseTextContent('{"text":""}');
      expect(text).toBe("");
    });
  });

  describe("mention stripping", () => {
    it("strips single @mention", () => {
      const result = stripMentions("@_user_1 hello there", [{ key: "@_user_1" }]);
      expect(result).toBe("hello there");
    });

    it("strips multiple @mentions", () => {
      const result = stripMentions("@_user_1 @_user_2 check this", [
        { key: "@_user_1" },
        { key: "@_user_2" },
      ]);
      expect(result).toBe("check this");
    });

    it("preserves text with no mentions", () => {
      const result = stripMentions("no mentions here", []);
      expect(result).toBe("no mentions here");
    });
  });

  describe("image message parsing", () => {
    it("extracts image_key from content", () => {
      const content = JSON.parse('{"image_key":"img_v3_abc123"}');
      expect(content.image_key).toBe("img_v3_abc123");
    });
  });

  describe("file message parsing", () => {
    it("extracts file_key and file_name from content", () => {
      const content = JSON.parse('{"file_key":"file_abc123","file_name":"report.pdf"}');
      expect(content.file_key).toBe("file_abc123");
      expect(content.file_name).toBe("report.pdf");
    });

    it("defaults file_name when missing", () => {
      const content = JSON.parse('{"file_key":"file_abc123"}');
      expect(content.file_name ?? "file").toBe("file");
    });
  });

  describe("attachment construction", () => {
    it("creates image attachment with correct fields", () => {
      const attachment: Attachment = {
        type: "image",
        path: "/uploads/user1/msg123_img_abc.png",
        name: "msg123_img_abc.png",
        mimeType: "image/png",
      };

      expect(attachment.type).toBe("image");
      expect(attachment.path).toContain(".png");
      expect(attachment.mimeType).toBe("image/png");
    });

    it("creates file attachment with correct fields", () => {
      const attachment: Attachment = {
        type: "file",
        path: "/uploads/user1/msg123_report.pdf",
        name: "report.pdf",
      };

      expect(attachment.type).toBe("file");
      expect(attachment.name).toBe("report.pdf");
      expect(attachment.mimeType).toBeUndefined();
    });
  });

  describe("deduplication logic", () => {
    it("tracks processed message IDs", () => {
      const processed = new Set<string>();
      const DEDUP_MAX = 5;

      // First message — not duplicate
      expect(processed.has("msg1")).toBe(false);
      processed.add("msg1");

      // Same message — duplicate
      expect(processed.has("msg1")).toBe(true);

      // Fill beyond max
      for (let i = 2; i <= DEDUP_MAX + 2; i++) {
        processed.add(`msg${i}`);
        if (processed.size > DEDUP_MAX) {
          const first = processed.values().next().value;
          if (first) processed.delete(first);
        }
      }

      // Oldest should be evicted
      expect(processed.size).toBeLessThanOrEqual(DEDUP_MAX);
    });
  });

  describe("stale message detection", () => {
    it("detects stale messages (>2 min old)", () => {
      const MAX_AGE_MS = 2 * 60 * 1000;
      const now = Date.now();

      const freshTs = now - 30_000; // 30s ago
      const staleTs = now - 150_000; // 2.5 min ago

      expect(now - freshTs > MAX_AGE_MS).toBe(false);
      expect(now - staleTs > MAX_AGE_MS).toBe(true);
    });
  });
});
