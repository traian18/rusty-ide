import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { agentChatDefinition } from "./agent_chat";
import { specTasksCheckTool } from "./specTasksCheckTool";

const signal = {} as never;
const change = { root: "/ws", change: "0001-context-visibility" };

describe("spec_tasks_check", () => {
  beforeEach(() => invoke.mockReset());

  it("passes a task list that covers the spec", async () => {
    invoke.mockResolvedValue([{ file: "specs/changes/0001/spec.md", line: 3, severity: "note", message: "an open question" }]);
    const result = await specTasksCheckTool(change)({ tasks: "# Tasks\n- [ ] **T1** A. R1 (C1)" }, signal);
    expect(invoke).toHaveBeenCalledWith("specs_tasks_check", { root: "/ws", change: "0001-context-visibility", tasks: "# Tasks\n- [ ] **T1** A. R1 (C1)" });
    expect(result.ok).toBe(true);
  });

  it("sends back each gap with where it is, so the step can fix the list", async () => {
    invoke.mockResolvedValue([
      { file: "specs/changes/0001/spec.md", line: 30, severity: "warning", message: "C2 is not named by any task" },
      { file: "specs/changes/0001/tasks.md", line: 9, severity: "warning", message: "T3 names no criterion" },
    ]);
    const result = await specTasksCheckTool(change)({ tasks: "…" }, signal);
    expect(result.ok).toBe(false);
    const error = result.ok ? "" : result.error;
    expect(error).toContain("- C2 is not named by any task (spec.md line 30)");
    expect(error).toContain("- T3 names no criterion (tasks.md line 9)");
    expect(error).toContain("whole corrected task list");
  });
});

describe("where spec_tasks_check is offered", () => {
  const base = {
    tabId: "tab-1", message: "plan", workspaceRoot: "/ws", model: "m", chatHistory: [], mcpServers: [],
    customProvider: { id: "p1", name: "Anthropic", baseUrl: "https://api.anthropic.com", apiKey: "k", modelId: "m", models: [], type: "anthropic" },
  };
  const names = (extra: object) => agentChatDefinition.recipe!({ ...base, ...extra } as never).host_tools?.map((tool) => tool.name) ?? [];

  it("only in a Design & tasks run of a change", () => {
    const workflow = { definition: {}, input: {} };
    expect(names({ workflow, specRun: { ...change, step: "plan" } })).toContain("spec_tasks_check");
    expect(names({ workflow, specRun: { ...change, step: "implement" } })).not.toContain("spec_tasks_check");
    expect(names({ workflow })).not.toContain("spec_tasks_check");
    expect(names({ specRun: { ...change, step: "plan" } })).not.toContain("spec_tasks_check");
  });
});
