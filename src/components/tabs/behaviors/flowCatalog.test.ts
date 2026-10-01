import { describe, expect, it } from "vitest";
import type { JsonObject } from "./behaviorModel";
import {
  profileMayEdit,
  shortWorkflowId,
  workflowMayEdit,
  workflowRoute,
  workflowSwitchTargets,
} from "./flowCatalog";
import { STARTER_PROFILES, STARTER_WORKFLOWS } from "./starterFlow";

const doc = (metadata: unknown): JsonObject => ({ id: "x", nodes: [], edges: [], metadata } as unknown as JsonObject);
const agent = (profile?: string): JsonObject => ({ id: "a", type: "agent", config: profile ? { profile: { id: profile } } : {} });

describe("workflowRoute", () => {
  it("reads the criterion the router is shown", () => {
    expect(workflowRoute(doc({ route: { when: "  The user wants X.  " } }))).toEqual({ when: "The user wants X." });
  });
  it("is absent without a usable criterion", () => {
    for (const metadata of [undefined, {}, { route: {} }, { route: { when: "   " } }, { route: { when: 3 } }, { route: "x" }]) {
      expect(workflowRoute(doc(metadata))).toBeUndefined();
    }
    expect(workflowRoute(undefined)).toBeUndefined();
  });
});

describe("workflowSwitchTargets", () => {
  it("lists declared ids once, trimmed, in order", () => {
    expect(workflowSwitchTargets(doc({ switch_to: ["a", " b ", "a", "", 7, "c"] }))).toEqual(["a", "b", "c"]);
  });
  it("is empty without a list", () => {
    expect(workflowSwitchTargets(doc({}))).toEqual([]);
    expect(workflowSwitchTargets(doc({ switch_to: "a" }))).toEqual([]);
    expect(workflowSwitchTargets(undefined)).toEqual([]);
  });
});

describe("shortWorkflowId", () => {
  it("drops the built-in namespace only", () => {
    expect(shortWorkflowId("rusty-ide.builtin.investigate")).toBe("investigate");
    expect(shortWorkflowId("mine")).toBe("mine");
  });
});

describe("profileMayEdit", () => {
  const tools = (type: string, list?: string[]) => ({ tools: { type, ...(list ? { tools: list } : {}) } });
  const deny = (when?: unknown) => ({ rules: [{ id: "r", on: "PreToolUse", ...(when === undefined ? {} : { when }), do: { deny: { reason: "no" } } }] });

  it("cannot edit when the allow-list leaves out write_file", () => {
    expect(profileMayEdit(tools("allow_list", ["read_file"]) as JsonObject)).toBe(false);
    expect(profileMayEdit(tools("allow_list", ["read_file", "write_file"]) as JsonObject)).toBe(true);
    expect(profileMayEdit(tools("inherit") as JsonObject)).toBe(true);
  });
  it("can edit through edit_file alone, since it changes files as write_file does", () => {
    expect(profileMayEdit(tools("allow_list", ["read_file", "edit_file"]) as JsonObject)).toBe(true);
  });
  it("cannot edit when a PreToolUse rule denies write_file", () => {
    expect(profileMayEdit({ ...tools("inherit"), ...deny({ tool: ["write_file"] }) } as JsonObject)).toBe(false);
    expect(profileMayEdit({ ...tools("inherit"), ...deny({ tool: "write_file" }) } as JsonObject)).toBe(false);
    expect(profileMayEdit({ ...tools("inherit"), ...deny({ tool: "*" }) } as JsonObject)).toBe(false);
    expect(profileMayEdit({ ...tools("inherit"), ...deny() } as JsonObject)).toBe(false);
  });
  it("can edit when the rule is about other tools, other events or other actions", () => {
    expect(profileMayEdit({ ...tools("inherit"), ...deny({ tool: ["run_command"] }) } as JsonObject)).toBe(true);
    expect(profileMayEdit({ ...tools("inherit"), rules: [{ id: "r", on: "PostToolUse", when: { tool: ["write_file"] }, do: { deny: {} } }] } as JsonObject)).toBe(true);
    expect(profileMayEdit({ ...tools("inherit"), rules: [{ id: "r", on: "PreToolUse", when: { tool: ["write_file"] }, do: { inject: { text: "careful" } } }] } as JsonObject)).toBe(true);
  });
  it("assumes an unknown profile can edit", () => {
    expect(profileMayEdit(undefined)).toBe(true);
  });
});

describe("workflowMayEdit", () => {
  const library = [
    { id: "ro", tools: { type: "allow_list", tools: ["read_file"] } },
    { id: "rusty-ide.builtin.rw", tools: { type: "inherit" } },
  ] as unknown as JsonObject[];
  const flow = (...steps: JsonObject[]) => ({ nodes: [{ id: "input", type: "input" }, ...steps] }) as unknown as JsonObject;

  it("is false only when every agent step is read-only", () => {
    expect(workflowMayEdit(flow(agent("ro"), agent("ro")), library)).toBe(false);
    expect(workflowMayEdit(flow(agent("ro"), agent("rw")), library)).toBe(true);
  });
  it("finds a built-in profile by its short or namespaced id", () => {
    expect(workflowMayEdit(flow(agent("rw")), library)).toBe(true);
    expect(workflowMayEdit(flow(agent("rusty-ide.builtin.rw")), library)).toBe(true);
  });
  it("counts a step without a profile, or with a missing one, as able to edit", () => {
    expect(workflowMayEdit(flow(agent()), library)).toBe(true);
    expect(workflowMayEdit(flow(agent("gone")), library)).toBe(true);
  });
  it("is false for a workflow with no agent step", () => {
    expect(workflowMayEdit(flow(), library)).toBe(false);
  });
});

describe("the built-in workflows", () => {
  const byId = (id: string) => STARTER_WORKFLOWS.find((document) => shortWorkflowId(String(document.id)) === id)!;

  it("edit exactly where the catalog says: only the read-mostly stages do not", () => {
    const readOnly = STARTER_WORKFLOWS
      .filter((document) => !workflowMayEdit(document, STARTER_PROFILES))
      .map((document) => shortWorkflowId(String(document.id)))
      .sort();
    expect(readOnly).toEqual(["check-changes", "design", "diagnose", "investigate", "security-audit"]);
    expect(workflowMayEdit(byId("implement"), STARTER_PROFILES)).toBe(true);
  });

  it("describe when each routable workflow applies", () => {
    const routable = STARTER_WORKFLOWS.filter((document) => workflowRoute(document)).map((document) => shortWorkflowId(String(document.id))).sort();
    expect(routable).toEqual(["check-changes", "design", "diagnose", "implement", "investigate", "security-audit"]);
    for (const id of routable) expect(workflowRoute(byId(id))!.when.length, id).toBeGreaterThan(60);
  });

  it("only offer to switch to workflows that exist, never to themselves, and every pipeline offers some", () => {
    const ids = new Set(STARTER_WORKFLOWS.map((document) => shortWorkflowId(String(document.id))));
    for (const document of STARTER_WORKFLOWS) {
      const id = shortWorkflowId(String(document.id));
      const targets = workflowSwitchTargets(document);
      expect(targets.length, id).toBeGreaterThan(0);
      for (const target of targets) {
        expect(ids.has(target), `${id} -> ${target}`).toBe(true);
        expect(target, id).not.toBe(id);
      }
    }
  });

  it("switch automatically only to targets that cannot edit, so no switch needs a confirmation by default", () => {
    for (const document of STARTER_WORKFLOWS) {
      for (const target of workflowSwitchTargets(document)) {
        expect(workflowMayEdit(byId(target), STARTER_PROFILES), `${String(document.id)} -> ${target}`).toBe(false);
      }
    }
  });
});
