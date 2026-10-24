import { describe, expect, it } from "vitest";
import { workingMethod } from "./agentWorkingMethod";

const FULL = ["read_file", "edit_file", "write_file", "search_codebase", "run_check", "update_todos", "agent_spawn", "spec_context"];

describe("workingMethod", () => {
  it("is empty without tools", () => {
    expect(workingMethod([])).toBe("");
  });

  it("gives an editing chat the whole method", () => {
    const text = workingMethod(FULL);
    for (const heading of ["How to work on a request", "Planning:", "Using your tools well", "Changing code", "Checking your work", "Specs:", "Delegating", "When to ask", "Communicating"]) {
      expect(text).toContain(heading);
    }
    expect(text).toContain("'update_todos'");
  });

  it("makes the repository tools standard practice when they are granted", () => {
    const tools = [...FULL, "repo_context", "repo_overview", "repo_risk", "repo_health", "repo_symbol", "repo_wiki"];
    const text = workingMethod(tools);
    expect(text).toContain("Rusty's standard practice");
    for (const part of ["blast_radius", "'repo_risk'", "'repo_health'", "Say what you used"]) expect(text).toContain(part);
    const readOnly = workingMethod(["read_file", "repo_context", "repo_health"], { planOnly: true });
    expect(readOnly).toContain("Rusty's standard practice");
    expect(readOnly).not.toContain("blast radius before you change");
    expect(workingMethod(FULL)).not.toContain("Rusty's standard practice");
  });

  it("leaves out editing and checking for a read-only chat and plans instead", () => {
    const text = workingMethod(["read_file", "search_codebase"], { planOnly: true });
    expect(text).toContain("Plan mode");
    expect(text).not.toContain("Changing code");
    expect(text).not.toContain("Checking your work");
    expect(text).not.toContain("Delegating");
  });

  it("tells a workflow step to stay within its step", () => {
    const text = workingMethod(FULL, { workflow: true });
    expect(text).toContain("one step of a workflow");
    expect(text).not.toContain("Planning:");
    expect(text).not.toContain("When to ask");
  });

  it("has every workflow step write its own plan first, when it can keep one", () => {
    expect(workingMethod(FULL, { workflow: true })).toContain("Your step's plan");
    expect(workingMethod(["read_file", "search_codebase"], { workflow: true })).not.toContain("Your step's plan");
  });
});
