// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { WorkflowInspector, type WorkflowSelection } from "./WorkflowInspector";
import { STARTER_WORKFLOW } from "./starterFlow";
import type { JsonObject } from "./behaviorModel";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let saved: JsonObject;
function mount(selection: WorkflowSelection, workflow = STARTER_WORKFLOW) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  function Editor() {
    const [value, setValue] = useState(workflow);
    saved = value;
    return <WorkflowInspector workflow={value} selection={selection} issues={[]} profileIds={["plan", "build"]}
      onChange={setValue} onSelect={() => {}} onDrill={() => {}} />;
  }
  act(() => root.render(<Editor />));
}
afterEach(() => { act(() => root?.unmount()); host?.remove(); });

it("edits and clears optional budgets through numeric fields, preserving other settings", () => {
  mount({ kind: "workflow" }, { ...STARTER_WORKFLOW, policies: { max_tokens: 123, max_elapsed_ms: 5000 } });
  const duration = host.querySelector<HTMLInputElement>('input[id$="max_elapsed_ms"]')!;
  expect(duration.value).toBe("5");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { setter.call(duration, ""); duration.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(saved.policies).toEqual({ max_tokens: 123 });
  expect(host.textContent).toContain("Optional limits");
  expect(host.querySelector('textarea[id$="policies"]')).toBeNull();
});

it("lets a workflow step select context without editing JSON", () => {
  mount({ kind: "step", id: "build" }, {
    ...STARTER_WORKFLOW,
    nodes: (STARTER_WORKFLOW.nodes as JsonObject[]).map(node => node.id === "build" ? {
      ...node, config: { ...(node.config as JsonObject), structured_output: "text" },
    } : node),
  });
  const planLabel = [...host.querySelectorAll("label")].find((label) => label.textContent?.trim() === "Plan")!;
  const checkbox = planLabel.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  expect(checkbox.checked).toBe(true);
  act(() => checkbox.click());
  const build = (saved.nodes as JsonObject[]).find((node) => node.id === "build")!;
  expect(build.input_bindings).toEqual([
    { target: "request", source: { type: "run_input", pointer: "/request" } },
    { target: "context", source: { type: "run_input", pointer: "/context" } },
    { target: "plan_notes", source: { type: "node_output", node_id: "approve_plan", pointer: "/notes" } },
  ]);
  expect(host.textContent).toContain("Response format");
});
