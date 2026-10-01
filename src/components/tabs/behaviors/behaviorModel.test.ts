import { describe, expect, it } from "vitest";
import {
  actionType,
  addStep,
  connectProfiles,
  connectSteps,
  edgesOf,
  issuesUnder,
  layoutSteps,
  newProfile,
  newRule,
  newWorkflow,
  positionOf,
  removeStep,
  removeEdge,
  rulesOf,
  stepIssues,
  stepsOf,
  switchEdges,
  withPosition,
  type Issue,
  type JsonObject,
} from "./behaviorModel";
import { STARTER_PROFILES, STARTER_WORKFLOW } from "./starterFlow";

const issue = (path: string): Issue => ({ path, code: "x", message: path, blocking: true });

describe("positions", () => {
  it("round-trips through metadata.editor without touching other metadata", () => {
    const profile = { ...newProfile("p"), metadata: { owner: "me" } } as JsonObject;
    const placed = withPosition(profile, { x: 10.4, y: 20.6 });
    expect(positionOf(placed)).toEqual({ x: 10, y: 21 });
    expect((placed.metadata as JsonObject).owner).toBe("me");
    expect(positionOf(profile)).toBeUndefined();
  });
});

describe("starter profiles", () => {
  it("registers the complete app-owned catalog once and aligns workflow references", () => {
    const ids = STARTER_PROFILES.map((profile) => String(profile.id));
    expect(ids).toEqual([
      "rusty-ide.builtin.research", "rusty-ide.builtin.analyze", "rusty-ide.builtin.plan",
      "rusty-ide.builtin.build", "rusty-ide.builtin.verify", "rusty-ide.builtin.review",
      "rusty-ide.builtin.debug", "rusty-ide.builtin.architect", "rusty-ide.builtin.security",
      "rusty-ide.builtin.document", "rusty-ide.builtin.refactor", "rusty-ide.builtin.optimize",
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    const profiles = stepsOf(STARTER_WORKFLOW)
      .map((step) => (step.config as JsonObject).profile as JsonObject | undefined)
      .filter((profile): profile is JsonObject => Boolean(profile))
      .map((profile) => String(profile.id));
    expect(profiles).toEqual(["rusty-ide.builtin.plan", "rusty-ide.builtin.build", "rusty-ide.builtin.verify"]);
  });
});

describe("profiles", () => {
  it("draws switch rules as edges between known profiles only", () => {
    const build = connectProfiles(newProfile("build"), "review").profile;
    const stray = connectProfiles(newProfile("stray"), "missing").profile;
    const edges = switchEdges([build, stray, newProfile("review")]);
    expect(edges).toEqual([
      expect.objectContaining({ source: "build", target: "review", ruleIndex: 0 }),
    ]);
  });

  it("gives connected rules unique ids", () => {
    const once = connectProfiles(newProfile("a"), "b");
    const twice = connectProfiles(once.profile, "b");
    expect(rulesOf(twice.profile).map((rule) => rule.id)).toEqual(["switch-to-b", "switch-to-b-2"]);
    expect(twice.ruleIndex).toBe(1);
  });

  it("moves new rules to an event their action supports", () => {
    const rule = newRule(newProfile("p"), "RunStart", "deny");
    expect(rule.on).toBe("PreToolUse");
    expect(rule.when).toEqual({ tool: "*" });
    expect(actionType(rule)).toBe("deny");
    expect(newRule(newProfile("p"), "RunStart", "inject").when).toBeUndefined();
  });
});

describe("workflows", () => {
  const base = (): JsonObject => ({ schema_version: 1, id: "w", nodes: [], edges: [] });

  it("adds, connects, and removes steps with their edges", () => {
    let workflow = addStep(base(), "input", { x: 0, y: 0 }).workflow;
    const agent = addStep(workflow, "agent", { x: 300, y: 0 });
    workflow = agent.workflow;
    const second = addStep(workflow, "agent", { x: 600, y: 0 });
    workflow = second.workflow;
    expect(second.id).toBe("agent_2");

    workflow = connectSteps(workflow, "input", "agent");
    workflow = connectSteps(workflow, "input", "agent");
    expect(edgesOf(workflow)).toHaveLength(1);
    expect(stepsOf(workflow).find((step) => step.id === "agent")?.input_bindings).toEqual([
      { target: "input", source: { type: "node_output", node_id: "input", pointer: "" } },
    ]);
    const disconnected = removeEdge(workflow, String(edgesOf(workflow)[0].id));
    expect(stepsOf(disconnected).find((step) => step.id === "agent")?.input_bindings).toEqual([]);
    workflow = connectSteps(workflow, "agent", "agent_2", "on_failure");

    workflow = removeStep(workflow, "agent");
    expect(stepsOf(workflow).map((step) => step.id)).toEqual(["input", "agent_2"]);
    expect(edgesOf(workflow)).toEqual([]);
  });

  it("makes agent steps work with host-routed providers", () => {
    const template: JsonObject = {
      id: "rusty.default",
      nodes: [{ id: "execute", type: "agent", config: { instructions: "x", structured_output: "require" } }],
      edges: [],
    };
    const created = newWorkflow("mine", template);
    expect(created).toMatchObject({ id: "mine", status: "draft", revision: 1 });
    expect((stepsOf(created)[0].config as JsonObject).structured_output).toBe("text");
    expect((stepsOf(template)[0].config as JsonObject).structured_output).toBe("require");

    const added = addStep(base(), "agent", { x: 0, y: 0 }).workflow;
    const step = stepsOf(added)[0];
    expect((step.config as JsonObject).structured_output).toBe("text");
    expect(step.output_schema).toMatchObject({ type: "inline", name: "agent_output" });
  });

  it("points a new output step at the first agent", () => {
    let workflow = addStep(base(), "agent", { x: 0, y: 0 }).workflow;
    workflow = addStep(workflow, "output", { x: 0, y: 0 }).workflow;
    const output = stepsOf(workflow)[1];
    expect((output.config as JsonObject).source).toEqual({ type: "node_output", node_id: "agent", pointer: "" });
  });

  it("lays out unpositioned steps by distance from the input", () => {
    const workflow: JsonObject = {
      nodes: [
        { id: "out", type: "output" },
        { id: "in", type: "input" },
        { id: "mid", type: "agent" },
      ],
      edges: [
        { id: "a", source: "in", target: "mid", condition: "on_success" },
        { id: "b", source: "mid", target: "out", condition: "on_success" },
      ],
    };
    const positions = layoutSteps(workflow);
    expect(positions.get("in")!.x).toBeLessThan(positions.get("mid")!.x);
    expect(positions.get("mid")!.x).toBeLessThan(positions.get("out")!.x);
  });
});

describe("issues", () => {
  it("matches the core compilers' path notation", () => {
    const issues = [issue("rules[1]"), issue("rules[1].do"), issue("rules[10]"), issue("nodes.plan.config"), issue("nodes[2]")];
    expect(issuesUnder(issues, "rules[1]").map((found) => found.path)).toEqual(["rules[1]", "rules[1].do"]);
    expect(stepIssues(issues, 2, "plan").map((found) => found.path)).toEqual(["nodes.plan.config", "nodes[2]"]);
  });
});
