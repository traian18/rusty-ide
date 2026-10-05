import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import type { JsonObject } from "./behaviorModel";
import { behaviorService, workflowPath } from "./behaviorService";
import previousWorkflow from "./starter/legacy/v1/plan-build-verify.workflow.json";
import v2Workflow from "./starter/legacy/v2/plan-build-verify.workflow.json";
import {
  STARTER_PROFILES,
  STARTER_WORKFLOW,
  STARTER_WORKFLOWS,
  STARTER_WORKFLOW_ID,
  BUILTIN_WORKFLOW_PATH,
  builtinWorkflowDocument,
  isStarterWorkflowPath,
  starterWorkflowPaths,
} from "./starterFlow";
import v3Workflow from "./starter/legacy/v3/plan-build-verify.workflow.json";

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const nodes = STARTER_WORKFLOW.nodes as JsonObject[];
const edges = STARTER_WORKFLOW.edges as JsonObject[];
const profileIds = STARTER_PROFILES.map((profile) => String(profile.id));

describe("the starter flow documents", () => {
  it("is the flow it says it is: request → plan → build → verify → result", () => {
    expect(STARTER_WORKFLOW.id).toBe("rusty-ide.builtin.plan-build-verify");
    expect(nodes.map((node) => `${node.id}:${node.type}`)).toEqual([
      "input:input", "plan:agent", "build:agent", "verify:agent", "gate:verify", "output:output",
    ]);
    expect(edges.map((edge) => `${edge.source}>${edge.target}`)).toEqual([
      "input>plan", "plan>build", "build>verify", "verify>gate", "gate>output",
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
    referenced.push(String(((STARTER_WORKFLOW.output_contract as JsonObject).source as JsonObject).node_id));
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
      // Verify returns the verdict the gate reads, so it is JSON the host validates.
      expect(config.structured_output).toBe(node.id === "verify" ? "host_validated" : "text");
      // A step allow-list naming a tool the session lacks fails the whole run
      // before it starts, so narrowing happens in the profile instead.
      expect(config.tools).toEqual({ type: "inherit" });
    }
  });

  it("keeps Plan read-only and Build able to edit", () => {
    const profile = (name: string) => STARTER_PROFILES.find((entry) => entry.id === `rusty-ide.builtin.${name}`)!;
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
          ? Object.entries(value).flatMap(([key, entry]) => (key === "pointer" || key === "context" ? [] : text(entry)))
          : [];
    for (const node of nodes.filter((step) => step.type === "agent")) {
      expect(String((node.config as JsonObject).instructions).length).toBeGreaterThan(80);
      expect(node.output_schema).toBeTruthy();
    }
    for (const profile of STARTER_PROFILES) {
      expect(String(profile.description).length).toBeGreaterThan(20);
      expect(String((profile.instructions as JsonObject).text).length).toBeGreaterThan(80);
      expect(Array.isArray(profile.rules)).toBe(true);
      expect(profile.completion_gate).toBeTruthy();
      expect(profile.limits).toBeUndefined();
    }
    expect(STARTER_WORKFLOW.policies).toEqual({ max_total_attempts: 40, stall_timeout_ms: 600000 });
    for (const node of nodes) expect(node.timeout_ms).toBeUndefined();
    expect([STARTER_WORKFLOW, ...STARTER_PROFILES].flatMap(text).filter((entry) => entry.trim() === "")).toEqual([]);
  });

  it("gives every step a place on the canvas", () => {
    for (const node of nodes) {
      const position = ((node.metadata as JsonObject).editor as JsonObject).position as JsonObject;
      expect(typeof position.x).toBe("number");
      expect(typeof position.y).toBe("number");
    }
  });
});

describe("built-in workflow availability", () => {
  const legacyPath = workflowPath("/project", STARTER_WORKFLOW_ID);
  let files: Map<string, string>;
  beforeEach(() => {
    files = new Map();
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation((async (command: string, args: Record<string, string>) => {
      if (command === "get_directory_structure") return [...files.keys()].map((path) => ({ path, name: path.split("/").pop(), is_dir: false }));
      if (command === "read_file_disk") { if (!files.has(args.path)) throw new Error("missing"); return files.get(args.path); }
      if (command === "delete_file_or_dir") { files.delete(args.path); return; }
      throw new Error(`Unexpected disk mutation: ${command}`);
    }) as never);
  });
  it("is available in any project without writing files", async () => {
    for (const project of ["/project", "/other"]) {
      const { documents } = await behaviorService.loadWorkflows(project);
      expect(documents.map((doc) => doc.path)).toEqual(starterWorkflowPaths());
      expect(documents[0].path).toBe(BUILTIN_WORKFLOW_PATH);
      for (const [index, path] of starterWorkflowPaths().entries()) {
        expect(await behaviorService.readWorkflow(path)).toEqual(STARTER_WORKFLOWS[index]);
      }
      expect(await behaviorService.readWorkflow(BUILTIN_WORKFLOW_PATH)).toEqual(STARTER_WORKFLOW);
    }
    expect(files.size).toBe(0);
  });
  it("removes only exact generated starter copies and preserves user workflows", async () => {
    files.set(legacyPath, JSON.stringify(previousWorkflow));
    files.set("/project/.rusty/workflows/mine.json", JSON.stringify({ ...v2Workflow, id: "mine", name: "Mine" }));
    const { documents } = await behaviorService.loadWorkflows("/project");
    expect(files.has(legacyPath)).toBe(false);
    expect(documents).toHaveLength(STARTER_WORKFLOWS.length + 1);
    expect(documents.at(-1)!.document.id).toBe("mine");
  });
  it("keeps a customized starter file alongside the built-in", async () => {
    const custom = { ...previousWorkflow, name: "My changes" };
    files.set(legacyPath, JSON.stringify(custom));
    expect((await behaviorService.loadWorkflows("/project")).documents).toHaveLength(STARTER_WORKFLOWS.length + 1);
    expect(await behaviorService.readWorkflow(legacyPath)).toEqual(custom);
  });
  it("recognises the previously shipped revision as an unmodified starter", async () => {
    files.set(legacyPath, JSON.stringify(v3Workflow));
    const { documents } = await behaviorService.loadWorkflows("/project");
    expect(files.has(legacyPath)).toBe(false);
    expect(documents).toHaveLength(STARTER_WORKFLOWS.length);
  });
  it("restores old chat references after an unmodified starter is removed", async () => {
    expect(await behaviorService.readWorkflow(legacyPath)).toEqual(STARTER_WORKFLOW);
  });
  it("cannot be saved or deleted and returns independent copies", async () => {
    for (const path of starterWorkflowPaths()) {
      await expect(behaviorService.save(path, STARTER_WORKFLOW)).rejects.toThrow("read-only");
      await expect(behaviorService.remove(path)).rejects.toThrow("cannot be deleted");
    }
    const copy = builtinWorkflowDocument(); copy.name = "Changed";
    expect(builtinWorkflowDocument().name).not.toBe("Changed");
    expect(isStarterWorkflowPath(BUILTIN_WORKFLOW_PATH)).toBe(true);
    expect(isStarterWorkflowPath(legacyPath)).toBe(false);
  });
});
