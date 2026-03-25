import { describe, it, expect, vi } from "vitest";
import { CommandRegistry, expandPrompt } from "./registry.js";

describe("CommandRegistry", () => {
  it("registers and resolves a command by name", () => {
    const reg = new CommandRegistry();
    const handler = vi.fn();
    reg.register({ name: "help", description: "Show help", handler });
    const resolved = reg.resolve("help");
    expect(resolved).toBeDefined();
    expect(resolved!.name).toBe("help");
  });

  it("resolves commands by alias", () => {
    const reg = new CommandRegistry();
    const handler = vi.fn();
    reg.register({ name: "model", description: "Switch model", handler, aliases: ["m"] });
    expect(reg.resolve("m")?.name).toBe("model");
  });

  it("resolves by prefix if unique", () => {
    const reg = new CommandRegistry();
    reg.register({ name: "restart", description: "Restart", handler: vi.fn() });
    expect(reg.resolve("res")?.name).toBe("restart");
  });

  it("returns undefined for ambiguous prefix", () => {
    const reg = new CommandRegistry();
    reg.register({ name: "restart", description: "Restart", handler: vi.fn() });
    reg.register({ name: "reset", description: "Reset", handler: vi.fn() });
    expect(reg.resolve("res")).toBeUndefined();
  });

  it("returns undefined for unknown command", () => {
    const reg = new CommandRegistry();
    expect(reg.resolve("nonexistent")).toBeUndefined();
  });

  it("registers and resolves custom commands", () => {
    const reg = new CommandRegistry();
    reg.registerCustom({ name: "greet", description: "Greet", prompt: "Say hello" });
    expect(reg.resolve("greet")?.name).toBe("greet");
  });

  it("lists all commands without duplicates", () => {
    const reg = new CommandRegistry();
    reg.register({ name: "help", description: "Help", handler: vi.fn(), aliases: ["h"] });
    reg.register({ name: "model", description: "Model", handler: vi.fn() });
    reg.registerCustom({ name: "greet", description: "Greet", prompt: "Hi" });
    const all = reg.listAll();
    expect(all).toHaveLength(3);
    expect(all.map((c) => c.name).sort()).toEqual(["greet", "help", "model"]);
  });
});

describe("expandPrompt", () => {
  it("replaces numbered placeholders", () => {
    expect(expandPrompt("Hello {{1}}", "world")).toBe("Hello world");
  });

  it("replaces multiple numbered placeholders", () => {
    expect(expandPrompt("{{1}} and {{2}}", "foo bar")).toBe("foo and bar");
  });

  it("replaces {{args}} with full args string", () => {
    expect(expandPrompt("Do: {{args}}", "some task here")).toBe("Do: some task here");
  });

  it("replaces splat placeholder {{N*}}", () => {
    expect(expandPrompt("Files: {{2*}}", "cmd a.txt b.txt c.txt")).toBe("Files: a.txt b.txt c.txt");
  });

  it("handles missing args gracefully", () => {
    expect(expandPrompt("{{1}} {{2}}", "only")).toBe("only");
  });

  it("trims result", () => {
    expect(expandPrompt("  hello  ", "")).toBe("hello");
  });
});
