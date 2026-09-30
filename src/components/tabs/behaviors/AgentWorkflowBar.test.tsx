// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentWorkflowBar, type AgentWorkflowBarProps } from "./AgentWorkflowBar";

const WORKFLOW = {
  id: "flow",
  nodes: [
    { id: "out", name: "Output", type: "output" },
    { id: "in", name: "Input", type: "input" },
    { id: "build", name: "Build", type: "agent" },
  ],
  edges: [
    { id: "a", source: "in", target: "build", condition: "on_success" },
    { id: "b", source: "build", target: "out", condition: "on_success" },
  ],
};

describe("AgentWorkflowBar", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const render = async (props: Partial<AgentWorkflowBarProps>) => {
    const full: AgentWorkflowBarProps = {
      workflows: [],
      running: false,
      disabled: false,
      onSelect: vi.fn(),
      onEdit: vi.fn(),
      ...props,
    };
    await act(async () => root.render(<AgentWorkflowBar {...full} />));
    return full;
  };
  // The app's CustomSelect: a button that opens a listbox in a portal.
  const trigger = () => container.querySelector("#agent-workflow-select") as HTMLButtonElement;
  const options = () => [...document.body.querySelectorAll<HTMLElement>('[role="option"]')];
  const optionLabels = async () => {
    await act(async () => trigger().click());
    const labels = options().map((option) => option.textContent);
    await act(async () => trigger().click());
    return labels;
  };
  const pick = async (label: string) => {
    await act(async () => trigger().click());
    await act(async () => options().find((option) => option.textContent === label)!.click());
  };

  beforeEach(() => {
    localStorage.removeItem("rusty_workflow_bar_collapsed");
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("is always there, even before any workflow exists", async () => {
    const props = await render({});
    expect(trigger().textContent).toBe("Single agent");
    expect(await optionLabels()).toEqual(["Single agent"]);
    expect(container.textContent).toContain("Each message runs one agent loop.");
    const create = [...container.querySelectorAll("button")].find((button) => button.textContent === "Create a workflow")!;
    await act(async () => create.click());
    expect(props.onEdit).toHaveBeenCalledWith(undefined);
  });

  it("hides the controls without changing the workflow and remembers the choice", async () => {
    const props = await render({ selected: "/w/flow.json", definition: WORKFLOW });
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Hide workflow bar"]')!.click());
    expect(trigger()).toBeNull();
    expect(container.querySelector("ol")).toBeNull();
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(localStorage.getItem("rusty_workflow_bar_collapsed")).toBe("true");
    act(() => root.unmount());
    root = createRoot(container);
    await render(props);
    expect(trigger()).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(trigger()).not.toBeNull();
    expect(localStorage.getItem("rusty_workflow_bar_collapsed")).toBe("false");
  });

  it("selects a workflow and shows its steps in run order", async () => {
    const props = await render({ workflows: [{ path: "/w/flow.json", name: "Plan and build" }] });
    await pick("Workflow: Plan and build");
    expect(props.onSelect).toHaveBeenCalledWith("/w/flow.json");

    await render({ ...props, selected: "/w/flow.json", definition: WORKFLOW });
    expect(container.querySelector('[data-testid="workflow-chip"]')?.textContent).toContain("Plan and build");
    expect(container.textContent).toContain("Your next message runs this workflow.");
    const steps = [...container.querySelectorAll("ol li")].map((item) => item.getAttribute("aria-label"));
    expect(steps).toEqual(["Input: not run", "Build: not run", "Output: not run"]);
  });

  it("shows live progress while running and locks the choice", async () => {
    await render({
      workflows: [{ path: "/w/flow.json", name: "Plan and build" }],
      selected: "/w/flow.json",
      definition: WORKFLOW,
      running: true,
      disabled: true,
      run: {
        status: "running",
        startedAt: 0,
        current: "build",
        steps: {
          in: { nodeId: "in", status: "succeeded", attempt: 1 },
          build: { nodeId: "build", status: "running", attempt: 2 },
        },
      },
    });
    expect(trigger().disabled).toBe(true);
    await act(async () => trigger().click());
    expect(options()).toHaveLength(0);
    expect(container.textContent).toContain("Running step 2 of 3: Build (attempt 2)");
    expect(container.querySelector('[aria-current="step"]')?.getAttribute("aria-label")).toBe("Build: running");
    const steps = [...container.querySelectorAll("ol li")].map((item) => item.getAttribute("aria-label"));
    expect(steps).toEqual(["Input: done", "Build: running", "Output: not run"]);
    expect(container.textContent).toContain("×2");
    expect(container.querySelector('[aria-label="Stop following this workflow"]')).toBeNull();
  });

  it("reports the last run's failure and marks a missing workflow", async () => {
    await render({
      selected: "/w/gone.json",
      definition: WORKFLOW,
      run: { status: "failed", startedAt: 0, error: "Verify failed", steps: { build: { nodeId: "build", status: "failed", attempt: 1 } } },
    });
    expect(container.textContent).toContain("Last run failed. Your next message runs it again.");
    expect(container.textContent).toContain("Verify failed");
    expect(await optionLabels()).toContain("Workflow: gone.json (missing)");
  });
});
