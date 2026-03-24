import { describe, it, expect } from "vitest";
import { Workspace, getDefaultWorkspaceRoot } from "./workspace.js";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

describe("Workspace", () => {
  const root = "/tmp/test-workspace";
  const agentID = "test-agent";
  const ws = new Workspace(root, agentID);

  it("getDefaultWorkspaceRoot returns home dir based path", () => {
    const result = getDefaultWorkspaceRoot();
    expect(result).toBe(join(homedir(), ".atlasOS"));
  });

  it("agentDir is correct", () => {
    expect(ws.agentDir).toBe(resolve(root, "agents", agentID));
  });

  it("usersDir is correct", () => {
    expect(ws.usersDir).toBe(resolve(root, "agents", agentID, "users"));
  });

  it("soulPath returns correct path", () => {
    expect(ws.soulPath()).toBe(resolve(root, "agents", agentID, "SOUL.md"));
  });

  it("userDir returns correct path", () => {
    expect(ws.userDir("user1")).toBe(resolve(root, "agents", agentID, "users", "user1"));
  });

  it("userMemoryPath returns correct path", () => {
    expect(ws.userMemoryPath("user1")).toContain("MEMORY.md");
  });

  it("userClaudePath returns correct path", () => {
    expect(ws.userClaudePath("user1")).toContain("CLAUDE.md");
  });

  it("uploadsDir returns correct path", () => {
    const result = ws.uploadsDir("user1");
    expect(result).toBe(resolve(root, "agents", agentID, "users", "user1", "uploads"));
  });

  it("isPathInWorkspace validates paths", () => {
    expect(ws.isPathInWorkspace(join(root, "agents", "test-agent", "file.txt"))).toBe(true);
    expect(ws.isPathInWorkspace("/etc/passwd")).toBe(false);
    expect(ws.isPathInWorkspace("/tmp/other")).toBe(false);
  });

  it("agentsRoot returns correct path", () => {
    expect(ws.agentsRoot).toBe(resolve(root, "agents"));
  });

  it("forAgent creates workspace for different agent", () => {
    const other = ws.forAgent("other-agent");
    expect(other.agentID).toBe("other-agent");
    expect(other.agentDir).toBe(resolve(root, "agents", "other-agent"));
    // Root is shared
    expect(other.root).toBe(ws.root);
  });

  it("agentExists returns false for non-existent agent", () => {
    expect(ws.agentExists("non-existent-agent-xyz")).toBe(false);
  });

  it("listAgents returns array", () => {
    // On a fresh temp dir, may return empty or existing agents
    const agents = ws.listAgents();
    expect(Array.isArray(agents)).toBe(true);
  });
});
