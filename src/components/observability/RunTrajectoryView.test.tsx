// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RunTrajectoryView } from "./RunTrajectoryView";
import { trajectories } from "../../observability/trajectoryStore";
import { inferExecutionOrigin, createContextSnapshot } from "../../observability/origin";

it("lets users inspect model context and filter failures in the run trajectory", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const input = { tabId: "agent", message: "Fix the app", workspaceRoot: "/ws", model: "test-model", chatHistory: [], customProvider: null, skill: null, mcpServers: [], planOnly: false, vfsOnly: false, lspSettings: {} };
  trajectories.start("ui-run", inferExecutionOrigin("agent_chat", input), createContextSnapshot("agent_chat", input));
  trajectories.append("ui-run", "Model request", { system_prompt: "Use the attached context", messages: ["Fix the app"] });
  trajectories.append("ui-run", "ToolCallCompleted", { has_error: true, output_preview: "fatal: not a git repository" });
  trajectories.finish("ui-run", "failed", { error: "no response" });
  const element = document.createElement("div"); document.body.append(element);
  const root = createRoot(element);
  try {
    await act(async () => root.render(<RunTrajectoryView />));
    expect(element.textContent).toContain("test-model");
    expect(element.textContent).toContain("Use the attached context");
    expect(element.querySelectorAll("details")).toHaveLength(3);
    const filter = element.querySelector<HTMLSelectElement>('[aria-label="Filter trajectory source"]')!;
    await act(async () => { filter.value = "ToolCallCompleted"; filter.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(element.querySelectorAll("details")).toHaveLength(1);
    expect(element.textContent).toContain("fatal: not a git repository");
  } finally {
    await act(async () => root.unmount()); element.remove(); trajectories.remove(() => true); vi.unstubAllGlobals();
  }
});
