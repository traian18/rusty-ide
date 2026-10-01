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

  it("labels stages apart from end-to-end workflows and says what a stage does with the last result", async () => {
    const stage = { ...WORKFLOW, metadata: { kind: "stage" }, nodes: [
      ...WORKFLOW.nodes,
    ].map((node) => node.id === "build" ? { ...node, input_bindings: [{ target: "context", source: { type: "run_input", pointer: "/context" } }] } : node) };
    const props = await render({
      workflows: [
        { path: "builtin:pipeline", name: "Plan, build, verify" },
        { path: "builtin:stage", name: "Research & analyze", kind: "stage", description: "Investigate a specific piece of functionality." },
      ],
    });
    expect(await optionLabels()).toEqual(["Single agent", "Workflow: Plan, build, verify", "Stage: Research & analyze"]);

    await render({ ...props, selected: "builtin:stage", definition: stage });
    expect(container.textContent).toContain("Your next message runs this stage, building on the last result in this chat.");
    expect(container.querySelector(".summary, [class*=summary]")?.getAttribute("title")).toBe("Investigate a specific piece of functionality.");

    // After a stage completes the user is pointed at the next move, not just "run it again".
    await render({ ...props, selected: "builtin:stage", definition: stage, run: { status: "completed", startedAt: 0, steps: {} } });
    expect(container.textContent).toContain("Stage complete. Amend it in your next message or pick the next stage; it builds on this result.");
  });

  it("does not claim a workflow builds on earlier results when it never reads them", async () => {
    await render({ workflows: [{ path: "/w/flow.json", name: "Plan and build" }], selected: "/w/flow.json", definition: WORKFLOW });
    expect(container.textContent).toContain("Your next message runs this workflow.");
    expect(container.textContent).not.toContain("building on");
  });

  describe("Auto and flow switching", () => {
    const workflows = [{ path: "/w/flow.json", name: "Plan and build" }];
    const toggle = () => container.querySelector('input[type="checkbox"]') as HTMLInputElement | null;

    it("offers Auto only when Rusty can choose, and says what it needs when it cannot", async () => {
      await render({ workflows });
      expect(await optionLabels()).toEqual(["Single agent", "Workflow: Plan and build"]);

      const props = await render({ workflows, autoAvailable: true });
      expect(await optionLabels()).toEqual(["Single agent", "Auto: choose a workflow for each message", "Workflow: Plan and build"]);
      await pick("Auto: choose a workflow for each message");
      expect(props.onSelect).toHaveBeenCalledWith("auto");

      // A saved Auto chat still shows it, with what is missing.
      await render({ workflows, selected: "auto" });
      expect(await optionLabels()).toContain("Auto (needs OpenRouter and a JEV model)");
    });

    it("shows Auto, then the workflow it chose, in the chip and the step list", async () => {
      await render({ workflows, autoAvailable: true, selected: "auto" });
      expect(container.querySelector('[data-testid="workflow-chip"]')?.textContent).toContain("Auto");
      expect(container.textContent).toContain("Each message picks the best workflow, or answers directly. Anything that edits files asks first.");
      expect(container.textContent).toContain("Design workflows");

      await render({ workflows, autoAvailable: true, selected: "auto", definition: { ...WORKFLOW, name: "Research & analyze" } });
      expect(container.querySelector('[data-testid="workflow-chip"]')?.textContent).toContain("Auto · Research & analyze");
      expect(container.textContent).toContain("Last: Research & analyze. Your next message picks again");
      expect([...container.querySelectorAll("ol li")].map((item) => item.getAttribute("aria-label"))).toEqual(["Input: not run", "Build: not run", "Output: not run"]);
    });

    it("lets the user allow flow switching for a workflow or for Auto, and locks it during a run", async () => {
      expect(toggle()).toBeNull();
      await render({ workflows });
      expect(toggle()).toBeNull();

      const onFlowSwitchingChange = vi.fn();
      await render({ workflows, selected: "/w/flow.json", definition: WORKFLOW, flowSwitching: false, onFlowSwitchingChange });
      expect(container.textContent).toContain("Allow flow switching");
      expect(toggle()!.checked).toBe(false);
      await act(async () => toggle()!.click());
      expect(onFlowSwitchingChange).toHaveBeenCalledWith(true);

      await render({ workflows, selected: "/w/flow.json", definition: WORKFLOW, flowSwitching: true, onFlowSwitchingChange });
      expect(toggle()!.checked).toBe(true);
      await render({ workflows, selected: "/w/flow.json", definition: WORKFLOW, flowSwitching: true, onFlowSwitchingChange, disabled: true });
      expect(toggle()!.disabled).toBe(true);
      await render({ workflows, autoAvailable: true, selected: "auto", onFlowSwitchingChange });
      expect(toggle()).not.toBeNull();
    });

    it("explains what switching does, or that the workflow declares nothing to switch to", async () => {
      const label = () => container.querySelector("label[title]")?.getAttribute("title");
      await render({ workflows, selected: "/w/flow.json", definition: WORKFLOW, onFlowSwitchingChange: vi.fn() });
      expect(label()).toBe("This workflow does not declare any workflow to hand over to.");
      await render({ workflows, selected: "/w/flow.json", definition: { ...WORKFLOW, metadata: { switch_to: ["diagnose"] } }, onFlowSwitchingChange: vi.fn() });
      expect(label()).toMatch(/Switching to a workflow that edits files asks you first/);
    });
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
