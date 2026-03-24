import { describe, it, expect } from "vitest";
import { parseSpawnTasks, stripSpawnTasks } from "./task-spawner.js";

describe("parseSpawnTasks", () => {
  it("parses tasks with dashes and quotes", () => {
    const text = `I'll break this into sub-tasks:

[SPAWN_TASKS]
- "Research authentication patterns"
- "Analyze existing API endpoints"
- "Review database schema"
[/SPAWN_TASKS]

I'll summarize the results once they complete.`;

    const tasks = parseSpawnTasks(text);
    expect(tasks).not.toBeNull();
    expect(tasks).toHaveLength(3);
    expect(tasks![0].description).toBe("Research authentication patterns");
    expect(tasks![1].description).toBe("Analyze existing API endpoints");
    expect(tasks![2].description).toBe("Review database schema");
  });

  it("parses tasks without quotes", () => {
    const text = `[SPAWN_TASKS]
- Research authentication patterns
- Analyze existing API endpoints
[/SPAWN_TASKS]`;

    const tasks = parseSpawnTasks(text);
    expect(tasks).toHaveLength(2);
    expect(tasks![0].description).toBe("Research authentication patterns");
  });

  it("parses numbered tasks", () => {
    const text = `[SPAWN_TASKS]
1. First task
2. Second task
[/SPAWN_TASKS]`;

    const tasks = parseSpawnTasks(text);
    expect(tasks).toHaveLength(2);
    expect(tasks![0].description).toBe("First task");
    expect(tasks![1].description).toBe("Second task");
  });

  it("returns null for text without spawn block", () => {
    expect(parseSpawnTasks("Just a normal response")).toBeNull();
  });

  it("returns null for empty task list", () => {
    const text = `[SPAWN_TASKS]

[/SPAWN_TASKS]`;
    expect(parseSpawnTasks(text)).toBeNull();
  });

  it("skips comment lines", () => {
    const text = `[SPAWN_TASKS]
# This is a comment
- Real task
// Another comment
- Another real task
[/SPAWN_TASKS]`;

    const tasks = parseSpawnTasks(text);
    expect(tasks).toHaveLength(2);
  });
});

describe("stripSpawnTasks", () => {
  it("removes the spawn tasks block", () => {
    const text = `Before tasks.

[SPAWN_TASKS]
- task 1
- task 2
[/SPAWN_TASKS]

After tasks.`;

    expect(stripSpawnTasks(text)).toBe("Before tasks.\n\n\n\nAfter tasks.");
  });

  it("returns original text if no block", () => {
    expect(stripSpawnTasks("no block")).toBe("no block");
  });
});
