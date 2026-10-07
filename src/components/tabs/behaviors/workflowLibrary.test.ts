import { describe, expect, it } from "vitest";
import type { JsonObject } from "./behaviorModel";
import { referencedFlowIds, workflowLibraryFor } from "./workflowLibrary";

const calling = (id: string, ...targets: string[]): JsonObject => ({
  id,
  nodes: targets.map((flow, index) => ({ id: `sub${index}`, type: "subflow", config: { target: { type: "flow", id: flow } } })),
});

describe("referencedFlowIds", () => {
  it("lists the flows subflow nodes and task queues name, once each, and not steps", () => {
    const workflow: JsonObject = {
      id: "main",
      nodes: [
        { id: "a", type: "subflow", config: { target: { type: "flow", id: "ws.research" } } },
        { id: "b", type: "subflow", config: { target: { type: "step", instructions: "Look." } } },
        { id: "c", type: "subflow", config: { target: { type: "flow", id: "ws.research" } } },
        { id: "build", type: "agent", config: { task_queue: { flows: { fix: { type: "flow", id: "ws.bugfix" }, ask: { type: "step", instructions: "x" } } } } },
      ],
    };
    expect(referencedFlowIds(workflow)).toEqual(["ws.research", "ws.bugfix"]);
  });
});

describe("workflowLibraryFor", () => {
  it("brings the saved flows a workflow runs, through the flows they run, without loops or built-ins", () => {
    const available = [calling("main", "a"), calling("a", "b", "rusty-ide.builtin.investigate"), calling("b", "main", "a"), calling("unused", "b")];
    const library = workflowLibraryFor(available[0], available);
    expect(library.map((document) => document.id)).toEqual(["a", "b"]);
  });

  it("leaves out a flow that is not saved; the run is refused by name instead", () => {
    expect(workflowLibraryFor(calling("main", "missing"), [])).toEqual([]);
  });
});
