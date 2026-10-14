import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import type { JsonObject } from "./behaviorModel";
import { behaviorService } from "./behaviorService";
import { BUILTIN_WORKFLOW_ID, BUILTIN_WORKFLOW_PATH, STARTER_WORKFLOW_ID } from "./starterFlow";
import { BUILTIN_PROFILES, BUILTIN_WORKFLOW } from "../../../test/fakeWorkflowCatalog";

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const nodes = BUILTIN_WORKFLOW.nodes as JsonObject[];
const edges = BUILTIN_WORKFLOW.edges as JsonObject[];
const profileIds = BUILTIN_PROFILES.map((profile) => String(profile.id));

describe("the starter flow documents", () => {
  it("is the flow it says it is: request → plan → approval → build → verify → manual checks → result", () => {
    expect(BUILTIN_WORKFLOW.id).toBe("rusty-ide.builtin.plan-build-verify");
    expect(nodes.map((node) => `${node.id}:${node.type}`)).toEqual([
      "input:input", "plan:agent", "approve_plan:approval", "build:agent", "verify:agent", "gate:verify", "confirm_checks:approval", "output:output",
    ]);
    expect(edges.map((edge) => `${edge.source}>${edge.target}`)).toEqual([
      "input>plan", "plan>approve_plan", "approve_plan>build", "build>verify", "verify>gate", "gate>confirm_checks", "confirm_checks>output",
    ]);
  });

  it("refers only to steps that exist", () => {
    const ids = new Set(nodes.map((node) => String(node.id)));
    const referenced: string[] = [];
    for (const node of nodes) {
      for (const binding of (node.input_bindings as JsonObject[]) ?? []) {
        const source = binding.source as JsonObject;
        if (source.type === "node_output") referenced.push(String(source.node_id));
      }
      const config = node.config as JsonObject;
      if (config.retry_target) referenced.push(String(config.retry_target));
      if (node.type === "output") referenced.push(String((config.source as JsonObject).node_id));
    }
    for (const edge of edges) referenced.push(String(edge.source), String(edge.target));
    referenced.push(String(((BUILTIN_WORKFLOW.output_contract as JsonObject).source as JsonObject).node_id));
    expect(referenced.filter((id) => !ids.has(id))).toEqual([]);
  });

  it("ships the profiles its agent steps name, under ids the editor accepts", () => {
    const named = nodes
      .filter((node) => node.type === "agent")
      .filter((node) => (node.config as JsonObject).profile)
      .map((node) => String(((node.config as JsonObject).profile as JsonObject).id));
    expect(named).toEqual(["rusty-ide.builtin.plan", "rusty-ide.builtin.build", "rusty-ide.builtin.verify"]);
    for (const id of named) expect(profileIds).toContain(id);
    for (const id of [...profileIds, STARTER_WORKFLOW_ID]) {
      expect(id).toMatch(ID_PATTERN);
      expect(id.startsWith("rusty.")).toBe(false);
    }
  });

  it("runs on any model: JSON text validated by the host, and tool scope left to the profile", () => {
    for (const node of nodes.filter((step) => step.type === "agent")) {
      const config = node.config as JsonObject;
      // Not `host_validated_fallback`: that still sends the provider's native
      // schema whenever the integration advertises one (OpenRouter always
      // does), on every request of a tool-using step. Gemini rejects tools
      // together with a JSON response type, and rejects a schema its
      // constraint compiler finds too large.
      // Verify returns the verdict the gate reads, the typed plan feeds the
      // task queue, and the queue returns its tasks: JSON the host validates.
      expect(config.structured_output).toBe(node.id === "verify" || node.id === "plan" || node.id === "build" ? "host_validated" : "text");
      // A step allow-list naming a tool the session lacks fails the whole run
      // before it starts, so narrowing happens in the profile instead.
      expect(config.tools).toEqual({ type: "inherit" });
    }
  });

  it("keeps Plan read-only and Build able to edit", () => {
    const profile = (name: string) => BUILTIN_PROFILES.find((entry) => entry.id === `rusty-ide.builtin.${name}`)!;
    const [plan, build, verify] = [profile("plan"), profile("build"), profile("verify")];
    const allowed = (plan.tools as JsonObject).tools as string[];
    expect((plan.tools as JsonObject).type).toBe("allow_list");
    expect(allowed).toEqual(expect.arrayContaining(["read_file", "list_files", "search_codebase"]));
    for (const tool of ["write_file", "run_command", "agent_spawn"]) expect(allowed).not.toContain(tool);
    expect((build.tools as JsonObject).tools).toContain("write_file");
    // Verify keeps the full read/run set but may not edit.
    expect((verify.tools as JsonObject).tools).not.toContain("write_file");
    expect(JSON.stringify(verify.rules)).toContain("write_file");
  });

  it("is complete: nothing in it is a blank placeholder", () => {
    // Every string in a document, except JSON Pointers: "" is the pointer to
    // the whole value (as in the built-in default workflow), not a blank.
    const text = (value: unknown): string[] =>
      typeof value === "string"
        ? [value]
        : value && typeof value === "object"
          ? Object.entries(value).flatMap(([key, entry]) => (key === "pointer" || key === "skip_if_empty" || key === "context" ? [] : text(entry)))
          : [];
    for (const node of nodes.filter((step) => step.type === "agent")) {
      expect(String((node.config as JsonObject).instructions).length).toBeGreaterThan(80);
      expect(node.output_schema).toBeTruthy();
    }
    for (const profile of BUILTIN_PROFILES) {
      expect(String(profile.description).length).toBeGreaterThan(20);
      expect(String((profile.instructions as JsonObject).text).length).toBeGreaterThan(80);
      expect(Array.isArray(profile.rules)).toBe(true);
      expect(profile.completion_gate).toBeTruthy();
      expect(profile.limits).toBeUndefined();
    }
    expect(BUILTIN_WORKFLOW.policies).toEqual({
      max_total_attempts: 40,
      stall_timeout_ms: 600000,
      research: { max_per_attempt: 2, profile: { id: "rusty-ide.builtin.research" } },
    });
    for (const node of nodes) expect(node.timeout_ms).toBeUndefined();
    expect([BUILTIN_WORKFLOW, ...BUILTIN_PROFILES].flatMap(text).filter((entry) => entry.trim() === "")).toEqual([]);
  });

  it("gives every step a place on the canvas", () => {
    for (const node of nodes) {
      const position = ((node.metadata as JsonObject).editor as JsonObject).position as JsonObject;
      expect(typeof position.x).toBe("number");
      expect(typeof position.y).toBe("number");
    }
  });
});

describe("built-in workflows", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation((async (command: string) => {
      throw new Error(`Unexpected disk mutation: ${command}`);
    }) as never);
  });

  it("are named by the ids the catalog lists them under", () => {
    expect(BUILTIN_WORKFLOW.id).toBe(BUILTIN_WORKFLOW_ID);
    expect(BUILTIN_WORKFLOW_PATH).toBe(`builtin:${STARTER_WORKFLOW_ID}`);
  });

  it("cannot be saved or deleted", async () => {
    await expect(behaviorService.save(BUILTIN_WORKFLOW_PATH, BUILTIN_WORKFLOW)).rejects.toThrow("read-only");
    await expect(behaviorService.remove(BUILTIN_WORKFLOW_PATH)).rejects.toThrow("cannot be deleted");
    expect(invoke).not.toHaveBeenCalled();
  });
});
