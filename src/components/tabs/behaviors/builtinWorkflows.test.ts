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
  implement: { kind: "stage", steps: ["plan", "build", "verify"] },
  "security-audit": { kind: "stage", steps: ["security", "plan"] },
  "check-changes": { kind: "stage", steps: ["review", "verify"] },
  "analyzed-feature": { kind: "end_to_end", steps: ["analyze", "plan", "build", "verify"] },
  "researched-feature": { kind: "end_to_end", steps: ["research", "architect", "plan", "build", "verify"] },
  "bug-fix": { kind: "end_to_end", steps: ["debug", "plan", "build", "verify"] },
  "careful-change": { kind: "end_to_end", steps: ["analyze", "plan", "build", "verify", "review"] },
  "security-remediation": { kind: "end_to_end", steps: ["security", "plan", "build", "verify", "security"] },
  refactor: { kind: "end_to_end", steps: ["analyze", "plan", "refactor", "verify", "review"] },
  "optimize-performance": { kind: "end_to_end", steps: ["analyze", "plan", "optimize", "verify"] },
  documentation: { kind: "end_to_end", steps: ["analyze", "plan", "document", "verify", "review"] },
};

const PREFIX = "rusty-ide.builtin.";
/** Multi-step changes run the approved plan as a task queue. */
const QUEUED = ["researched-feature", "careful-change", "security-remediation", "refactor"];
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
      if (kind === "stage") expect(steps, shortId(document)).toBeLessThanOrEqual(3);
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
      for (const node of nodesOf(document)) {
        if (node.type !== "agent") {
          seen.add(String(node.id));
          continue;
        }
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
        const acceptanceReviewer = ["verify", "review", "recheck"].includes(String(node.id)) && agentsOf(document).some(n => n.id === "build");
        // A queued flow's plan is a typed task plan, and its Build returns the tasks it completed.
        const typedPlan = QUEUED.includes(shortId(document)) && ["plan", "build"].includes(String(node.id));
        expect(configOf(node).structured_output).toBe(acceptanceReviewer || typedPlan ? "host_validated" : "text");
        expect(configOf(node).tools).toEqual({ type: "inherit" });
        expect(node.output_schema).toBeTruthy();
        if (!acceptanceReviewer && !typedPlan) {
          expect((node.output_schema as JsonObject).schema).toEqual({ type: "string" });
          expect(String(configOf(node).instructions)).not.toContain("Finish with exactly");
          for (const binding of bindings) {
            const source = binding.source as JsonObject;
            if (source.type === "node_output") {
              // An approval hands on only the user's notes.
              const approval = nodesOf(document).find((n) => n.id === source.node_id)?.type === "approval";
              expect(source.pointer).toBe(approval ? "/notes" : "");
            }
          }
        }
        seen.add(String(node.id));
      }
    }
  });

  it("advances ordinary steps on success without parsing status or summary fields", () => {
    for (const document of STARTER_WORKFLOWS) {
      const nodes = nodesOf(document);
      for (const agent of agentsOf(document).filter(n => configOf(n).structured_output === "text")) {
        const edge = (document.edges as JsonObject[]).find(e => e.source === agent.id)!;
        expect(edge.condition).toBe("on_success");
        expect(nodes.find(n => n.id === edge.target)!.type).not.toBe("verify");
      }
      const last = agentsOf(document).at(-1)!;
      if (configOf(last).structured_output === "text") {
        expect(configOf(nodes.at(-1)!).source).toEqual({ type: "node_output", node_id: last.id, pointer: "" });
        expect((document.output_contract as JsonObject).source).toEqual(configOf(nodes.at(-1)!).source);
      }
    }
  });

  it("asks the user to approve the plan before building, and to confirm the checks only a person can do", () => {
    for (const document of STARTER_WORKFLOWS) {
      const nodes = nodesOf(document);
      if (!nodes.some((n) => n.id === "build")) {
        expect(nodes.some((n) => n.type === "approval"), shortId(document)).toBe(false);
        continue;
      }
      const ids = nodes.map((n) => String(n.id));
      const approve = nodes.find((n) => n.id === "approve_plan")!;
      expect(approve.type).toBe("approval");
      expect(configOf(approve).subject).toEqual({ type: "node_output", node_id: "plan", pointer: "" });
      expect(ids.indexOf("approve_plan")).toBe(ids.indexOf("plan") + 1);
      expect(ids.indexOf("build")).toBe(ids.indexOf("approve_plan") + 1);
      // Notes given with the approval revise the plan, so everything after it
      // works from the plan as approved, and still sees the notes themselves.
      expect(configOf(approve).revise_on_notes).toBe(true);
      const notes = { target: "plan_notes", source: { type: "node_output", node_id: "approve_plan", pointer: "/notes" } };
      for (const step of agentsOf(document).slice(agentsOf(document).findIndex((n) => n.id === "build"))) {
        expect(step.input_bindings, `${shortId(document)}/${step.id}`).toContainEqual(notes);
        expect(String(configOf(step).instructions), `${shortId(document)}/${step.id}`).toContain("plan_notes");
      }
      const confirm = nodes.find((n) => n.id === "confirm_checks")!;
      expect(configOf(confirm)).toMatchObject({
        subject: { type: "node_output", node_id: "gate", pointer: "/manual_checks" },
        revise_target: "build",
        skip_if_empty: "",
      });
      // A final review's manual checks are asked too, after Verify's.
      const post = agentsOf(document).at(-1)!;
      if (post.id === "verify") {
        expect(ids.at(-2)).toBe("confirm_checks");
      } else {
        expect(ids.slice(-3)).toEqual(["confirm_checks", "confirm_review_checks", "output"]);
        expect(configOf(nodes.find((n) => n.id === "confirm_review_checks")!)).toMatchObject({
          subject: { type: "node_output", node_id: `${post.id}_gate`, pointer: "/manual_checks" },
          revise_target: "build",
          skip_if_empty: "",
        });
      }
    }
  });

  it("tells every step where it stands in its workflow and what it is given", () => {
    for (const document of STARTER_WORKFLOWS) {
      const agents = agentsOf(document);
      expect(String(document.description).length, shortId(document)).toBeGreaterThan(120);
      for (const [index, node] of agents.entries()) {
        const text = String(configOf(node).instructions);
        const where = `${shortId(document)}/${node.id}`;
        expect(text, where).toContain(`"${String(document.name)}" runs:`);
        expect(text, where).toContain(`You are ${String(node.name)}, step`);
        for (const binding of node.input_bindings as JsonObject[]) expect(text, where).toContain(`- ${String(binding.target)}: `);
        // Only the last step's message is the result; the others are told it is passed on.
        expect(text.includes("Only your final message is passed on"), where).toBe(index < agents.length - 1);
        expect(text.length, where).toBeGreaterThan(1200);
      }
    }
  });

  it("runs a multi-step plan as a task queue that asks on failure, and judges acceptance criterion by criterion", () => {
    for (const document of STARTER_WORKFLOWS) {
      const nodes = nodesOf(document);
      const queue = nodes.map(n => configOf(n).task_queue).find(Boolean) as JsonObject | undefined;
      if (QUEUED.includes(shortId(document))) {
        expect(queue, shortId(document)).toMatchObject({ plan_pointer: "/plan", review_profile: { id: `${PREFIX}review` }, on_task_failure: "ask" });
        expect(nodes.find(n => n.id === "plan")!.output_schema).toEqual({ type: "registry", schema_id: "rusty.task_plan", revision: 1 });
        expect(String(configOf(nodes.find(n => n.id === "verify")!).instructions)).toContain("under their ids");
        expect(configOf(nodes.find(n => n.id === "gate")!).checks).toEqual([{ type: "criteria", pointer: "/check/criteria", plan_pointer: "/plan" }]);
      } else {
        // Smaller changes: one build step implements the whole plan.
        expect(queue, shortId(document)).toBeUndefined();
      }
      const gate = nodes.find(n => n.id === "gate");
      if (!gate) continue;
      // Not a free-text verdict: fail goes back to Build, manual moves on.
      if (!QUEUED.includes(shortId(document))) expect(configOf(gate).checks).toEqual([{ type: "criteria", pointer: "/check/criteria" }]);
      const reviewer = nodes.find(n => n.id === "verify")!;
      const schema = (reviewer.output_schema as JsonObject).schema as JsonObject;
      const criterion = (((schema.properties as JsonObject).criteria as JsonObject).items as JsonObject).properties as JsonObject;
      expect((criterion.status as JsonObject).enum).toEqual(["pass", "fail", "manual"]);
      expect(String(configOf(reviewer).instructions)).toMatch(/manual/);
    }
  });

  it("never lets a final review or security recheck bypass acceptance", () => {
    for (const document of STARTER_WORKFLOWS) {
      const nodes = nodesOf(document);
      if (!agentsOf(document).some(n => n.id === "build")) continue;
      const last = agentsOf(document).at(-1)!;
      const edge = (document.edges as JsonObject[]).find(e => e.source === last.id)!;
      const gate = nodes.find(n => n.id === edge.target)!;
      expect(gate.type, shortId(document)).toBe("verify");
      expect(JSON.stringify(configOf(gate).checks)).toMatch(/"criteria"/);
    }
  });

  it("preserves context access and has finite attempt budgets in every workflow", () => {
    for (const document of STARTER_WORKFLOWS) {
      expect(workflowUsesContext(document), shortId(document)).toBe(true);
      expect((document.policies as JsonObject).max_total_attempts).toBe(40);
      for (const node of agentsOf(document)) {
        expect((node.input_bindings as JsonObject[]).map(b => b.target)).toContain("context");
        expect(node.timeout_ms).toBeUndefined();
      }
    }
  });

  it("does not offer editing, installation or delegation to read-only profiles", () => {
    for (const id of ["research", "analyze", "architect", "plan", "debug", "verify", "review", "security"]) {
      const profile = STARTER_PROFILES.find(p => p.id === `${PREFIX}${id}`)!;
      expect((profile.tools as JsonObject).type).toBe("allow_list");
      const tools = (profile.tools as JsonObject).tools as string[];
      expect(tools).toContain("read_workflow_context");
      for (const tool of ["write_file", "edit_file", "install_dependencies", "agent_spawn"]) expect(tools, id).not.toContain(tool);
    }
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
