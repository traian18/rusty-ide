import { describe, expect, it } from "vitest";
import type { JsonObject } from "./behaviorModel";
import { workflowUsesContext } from "../../../harness/core/workflowRun";
import {
  STARTER_PROFILES,
  STARTER_WORKFLOWS,
  builtinWorkflowDocument,
  builtinWorkflowPath,
  isStarterWorkflowPath,
  starterWorkflowPaths,
  workflowKind,
} from "./starterFlow";

/** What each built-in workflow runs, in order: the catalog the Agent's Mode picker offers. */
const CATALOG: Record<string, { kind: "stage" | "end_to_end"; steps: string[] }> = {
  "plan-build-verify": { kind: "end_to_end", steps: ["plan", "build", "verify"] },
  investigate: { kind: "stage", steps: ["research", "analyze"] },
  design: { kind: "stage", steps: ["architect", "plan"] },
  diagnose: { kind: "stage", steps: ["debug", "plan"] },
  implement: { kind: "stage", steps: ["build", "verify"] },
  "security-audit": { kind: "stage", steps: ["security", "plan"] },
  "check-changes": { kind: "stage", steps: ["verify", "review"] },
  "analyzed-feature": { kind: "end_to_end", steps: ["analyze", "plan", "build", "verify"] },
  "researched-feature": { kind: "end_to_end", steps: ["research", "architect", "plan", "build", "verify"] },
  "bug-fix": { kind: "end_to_end", steps: ["debug", "plan", "build", "verify"] },
  "careful-change": { kind: "end_to_end", steps: ["analyze", "plan", "build", "verify", "review"] },
  "security-remediation": { kind: "end_to_end", steps: ["security", "plan", "build", "verify", "security"] },
  refactor: { kind: "end_to_end", steps: ["analyze", "plan", "refactor", "verify", "review"] },
  "optimize-performance": { kind: "end_to_end", steps: ["analyze", "optimize", "verify"] },
  documentation: { kind: "end_to_end", steps: ["analyze", "document", "review"] },
};

const PREFIX = "rusty-ide.builtin.";
const profileIds = new Set(STARTER_PROFILES.map((profile) => String(profile.id)));
const nodesOf = (document: JsonObject) => document.nodes as JsonObject[];
const agentsOf = (document: JsonObject) => nodesOf(document).filter((node) => node.type === "agent");
const configOf = (node: JsonObject) => node.config as JsonObject;
const profileOf = (node: JsonObject) => String(((configOf(node).profile as JsonObject) ?? {}).id);
const shortId = (document: JsonObject) => String(document.id).slice(PREFIX.length);

describe("the built-in workflow catalog", () => {
  it("offers exactly the documented workflows, the everyday one first", () => {
    expect(STARTER_WORKFLOWS.map(shortId).sort()).toEqual(Object.keys(CATALOG).sort());
    expect(shortId(STARTER_WORKFLOWS[0])).toBe("plan-build-verify");
    expect(new Set(STARTER_WORKFLOWS.map((document) => document.id)).size).toBe(STARTER_WORKFLOWS.length);
  });

  it("runs each workflow's profiles in the documented order, all of them shipped with the app", () => {
    for (const document of STARTER_WORKFLOWS) {
      const expected = CATALOG[shortId(document)];
      expect(agentsOf(document).map(profileOf).map((id) => id.slice(PREFIX.length)), shortId(document)).toEqual(expected.steps);
      for (const node of agentsOf(document)) expect(profileIds.has(profileOf(node)), `${shortId(document)}/${node.id}`).toBe(true);
    }
  });

  it("separates short stages from end-to-end pipelines", () => {
    for (const document of STARTER_WORKFLOWS) {
      const { kind } = CATALOG[shortId(document)];
      const steps = agentsOf(document).length;
      if (kind === "stage") expect(steps, shortId(document)).toBeLessThanOrEqual(2);
      else expect(steps, shortId(document)).toBeGreaterThanOrEqual(3);
      // The built-in Plan, build, verify predates the marker; the rest declare theirs.
      if (shortId(document) !== "plan-build-verify") expect(workflowKind(document)).toBe(kind);
    }
  });

  it("is a straight line from the request to the last step's result", () => {
    for (const document of STARTER_WORKFLOWS) {
      const nodes = nodesOf(document);
      const edges = document.edges as JsonObject[];
      const order = nodes.map((node) => String(node.id));
      expect(order[0]).toBe("input");
      expect(order.at(-1)).toBe("output");
      expect(edges.map((edge) => `${edge.source}>${edge.target}`), shortId(document)).toEqual(
        order.slice(0, -1).map((id, index) => `${id}>${order[index + 1]}`),
      );
      const last = agentsOf(document).at(-1)!;
      const source = (configOf(nodes.at(-1)!).source as JsonObject).node_id;
      expect(source, shortId(document)).toBe(last.id);
      expect(((document.output_contract as JsonObject).source as JsonObject).node_id).toBe(last.id);
    }
  });

  it("hands each step its predecessors' text and only names inputs it was given", () => {
    for (const document of STARTER_WORKFLOWS) {
      const seen = new Set<string>();
      for (const node of agentsOf(document)) {
        const bindings = node.input_bindings as JsonObject[];
        const targets = bindings.map((binding) => String(binding.target));
        expect(targets).toContain("request");
        for (const binding of bindings) {
          const source = binding.source as JsonObject;
          // A node reads only steps that already ran.
          if (source.type === "node_output") expect(seen.has(String(source.node_id)), `${shortId(document)}/${node.id}`).toBe(true);
        }
        const mentioned = [...String(configOf(node).instructions).matchAll(/workflow_input\.(\w+)/g)].map((match) => match[1]);
        for (const name of mentioned) expect(targets, `${shortId(document)}/${node.id} mentions ${name}`).toContain(name);
        expect(String(configOf(node).instructions).length).toBeGreaterThan(80);
        expect(configOf(node).structured_output).toBe("text");
        expect(configOf(node).tools).toEqual({ type: "inherit" });
        expect(node.output_schema).toBeTruthy();
        seen.add(String(node.id));
      }
    }
  });

  it("lets every workflow but the original start from the previous run's result", () => {
    for (const document of STARTER_WORKFLOWS) {
      const first = agentsOf(document)[0];
      const reads = (first.input_bindings as JsonObject[]).some((binding) => (binding.source as JsonObject).pointer === "/context");
      if (shortId(document) === "plan-build-verify") {
        expect(workflowUsesContext(document)).toBe(false);
        continue;
      }
      expect(reads, shortId(document)).toBe(true);
      expect(workflowUsesContext(document)).toBe(true);
      // Only the opening step reads it, so a long chain does not repeat the result on every step.
      const readers = agentsOf(document).filter((node) => (node.input_bindings as JsonObject[]).some((binding) => (binding.source as JsonObject).pointer === "/context"));
      expect(readers.length, shortId(document)).toBeLessThanOrEqual(2);
    }
  });

  it("keeps the stages that promise investigation read-only", () => {
    const profile = (id: string) => STARTER_PROFILES.find((entry) => entry.id === id)!;
    const deniesWrites = (id: string) => JSON.stringify(profile(id).rules).includes("write_file") && JSON.stringify(profile(id).rules).includes("deny");
    for (const name of ["investigate", "design", "diagnose", "security-audit", "check-changes"]) {
      const document = STARTER_WORKFLOWS.find((entry) => shortId(entry) === name)!;
      for (const node of agentsOf(document)) expect(deniesWrites(profileOf(node)), `${name}/${node.id}`).toBe(true);
    }
    // And the one stage that carries out work uses the profile that can.
    const implement = STARTER_WORKFLOWS.find((entry) => shortId(entry) === "implement")!;
    expect(deniesWrites(profileOf(agentsOf(implement)[0]))).toBe(false);
  });

  it("makes the second security pass a re-audit of the first", () => {
    const remediation = STARTER_WORKFLOWS.find((entry) => shortId(entry) === "security-remediation")!;
    const recheck = agentsOf(remediation).at(-1)!;
    const inputs = (recheck.input_bindings as JsonObject[]).map((binding) => String(binding.target));
    expect(inputs).toEqual(expect.arrayContaining(["audit", "plan", "build", "verify"]));
  });
});

describe("built-in workflow paths", () => {
  it("map ids to paths and back, and only know the built-ins", () => {
    const paths = starterWorkflowPaths();
    expect(paths).toHaveLength(STARTER_WORKFLOWS.length);
    expect(paths.every((path) => path.startsWith("builtin:"))).toBe(true);
    for (const [index, document] of STARTER_WORKFLOWS.entries()) {
      expect(builtinWorkflowPath(String(document.id))).toBe(paths[index]);
      expect(builtinWorkflowPath(shortId(document))).toBe(paths[index]);
      expect(isStarterWorkflowPath(paths[index])).toBe(true);
    }
    expect(isStarterWorkflowPath("builtin:nope")).toBe(false);
    expect(isStarterWorkflowPath("/project/.rusty/workflows/investigate.json")).toBe(false);
  });

  it("return independent copies and reject an unknown path", () => {
    const path = builtinWorkflowPath("investigate");
    const copy = builtinWorkflowDocument(path);
    copy.name = "Changed";
    expect(builtinWorkflowDocument(path).name).toBe("Research & analyze");
    expect(() => builtinWorkflowDocument("builtin:nope")).toThrow("No built-in workflow");
  });
});
