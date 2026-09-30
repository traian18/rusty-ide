import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import type { JsonObject } from "./behaviorModel";
import { profilePath, workflowPath } from "./behaviorService";
import {
  STARTER_PROFILES,
  STARTER_SEEDED_STORAGE_KEY,
  STARTER_WORKFLOW,
  STARTER_WORKFLOW_ID,
  ensureStarterFlow,
  isStarterWorkflowPath,
} from "./starterFlow";

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const nodes = STARTER_WORKFLOW.nodes as JsonObject[];
const edges = STARTER_WORKFLOW.edges as JsonObject[];
const profileIds = STARTER_PROFILES.map((profile) => String(profile.id));

describe("the starter flow documents", () => {
  it("is the flow it says it is: request → plan → build → verify → result", () => {
    expect(STARTER_WORKFLOW.id).toBe(STARTER_WORKFLOW_ID);
    expect(nodes.map((node) => `${node.id}:${node.type}`)).toEqual([
      "input:input",
      "plan:agent",
      "build:agent",
      "verify:verify",
      "output:output",
    ]);
    expect(edges.map((edge) => `${edge.source}>${edge.target}`)).toEqual([
      "input>plan",
      "plan>build",
      "build>verify",
      "verify>output",
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
      .map((node) => String(((node.config as JsonObject).profile as JsonObject).id));
    expect(named).toEqual(["plan", "build"]);
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
      expect(config.structured_output).toBe("host_validated");
      // A step allow-list naming a tool the session lacks fails the whole run
      // before it starts, so narrowing happens in the profile instead.
      expect(config.tools).toEqual({ type: "inherit" });
    }
  });

  it("keeps Plan read-only and Build able to edit", () => {
    const [plan, build] = STARTER_PROFILES;
    const allowed = (plan.tools as JsonObject).tools as string[];
    expect((plan.tools as JsonObject).type).toBe("allow_list");
    expect(allowed).toEqual(expect.arrayContaining(["read_file", "list_files", "search_codebase"]));
    for (const tool of ["write_file", "run_command", "agent_spawn"]) expect(allowed).not.toContain(tool);
    expect(build.tools).toEqual({ type: "inherit" });
  });

  it("is complete: nothing in it is a blank placeholder", () => {
    // Every string in a document, except JSON Pointers: "" is the pointer to
    // the whole value (as in the built-in default workflow), not a blank.
    const text = (value: unknown): string[] =>
      typeof value === "string"
        ? [value]
        : value && typeof value === "object"
          ? Object.entries(value).flatMap(([key, entry]) => (key === "pointer" ? [] : text(entry)))
          : [];
    for (const node of nodes.filter((step) => step.type === "agent")) {
      expect(String((node.config as JsonObject).instructions).length).toBeGreaterThan(80);
      expect(node.output_schema).toBeTruthy();
    }
    for (const profile of STARTER_PROFILES) {
      expect(String(profile.description).length).toBeGreaterThan(20);
      expect(String((profile.instructions as JsonObject).text).length).toBeGreaterThan(80);
      expect((profile.rules as unknown[]).length).toBeGreaterThan(0);
      expect(profile.completion_gate).toBeTruthy();
      expect((profile.limits as JsonObject).final_turn_prompt).toBeTruthy();
    }
    expect(Object.keys(STARTER_WORKFLOW.policies as JsonObject)).toEqual(
      expect.arrayContaining(["max_steps", "max_total_attempts", "max_elapsed_ms", "max_model_requests", "max_tool_calls", "max_tokens", "max_cost_usd"]),
    );
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

describe("isStarterWorkflowPath", () => {
  it("matches the starter file on either separator, and nothing else", () => {
    expect(isStarterWorkflowPath(`/work/app/.rusty/workflows/${STARTER_WORKFLOW_ID}.json`)).toBe(true);
    expect(isStarterWorkflowPath(`C:\\work\\app\\.rusty\\workflows\\${STARTER_WORKFLOW_ID}.json`)).toBe(true);
    expect(isStarterWorkflowPath("/work/app/.rusty/workflows/mine.json")).toBe(false);
    expect(isStarterWorkflowPath(`/work/app/other/${STARTER_WORKFLOW_ID}.json`)).toBe(false);
  });
});

describe("ensureStarterFlow", () => {
  const root = "/work/app";
  const store = new Map<string, string>();
  const files = new Map<string, string>();
  let writes: string[];
  let failWrites = false;
  let calls: string[];

  const seededWorkflow = workflowPath(root, STARTER_WORKFLOW_ID);

  beforeEach(() => {
    store.clear();
    files.clear();
    writes = [];
    calls = [];
    failWrites = false;
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation((async (command: string, args?: Record<string, string>) => {
      calls.push(command);
      switch (command) {
        case "get_directory_structure": {
          const dir = args!.rootDir;
          return [...files.keys()]
            .filter((path) => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes("/"))
            .map((path) => ({ name: path.split("/").pop(), path, is_dir: false }));
        }
        case "read_file_disk": {
          const content = files.get(args!.path);
          if (content === undefined) throw new Error("no such file");
          return content;
        }
        case "create_directory":
          return undefined;
        case "write_file_disk":
          if (failWrites) throw new Error("disk full");
          files.set(args!.path, args!.content);
          writes.push(args!.path);
          return undefined;
        default:
          throw new Error(`unexpected command ${command}`);
      }
    }) as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes the profiles, then the workflow, into a workspace with none", async () => {
    await expect(ensureStarterFlow(root)).resolves.toBe(true);
    expect(writes).toEqual([profilePath(root, "plan"), profilePath(root, "build"), seededWorkflow]);
    expect(JSON.parse(files.get(seededWorkflow)!)).toEqual(STARTER_WORKFLOW);
    expect(JSON.parse(files.get(profilePath(root, "plan"))!)).toEqual(STARTER_PROFILES[0]);
    expect(JSON.parse(files.get(profilePath(root, "build"))!)).toEqual(STARTER_PROFILES[1]);
  });

  it("leaves a workspace that already has its own workflow alone", async () => {
    files.set(workflowPath(root, "mine"), "{}");
    await expect(ensureStarterFlow(root)).resolves.toBe(false);
    expect(writes).toEqual([]);
  });

  it("never overwrites a file the user already has at one of its paths", async () => {
    const theirs = '{"id":"plan","note":"theirs"}';
    files.set(profilePath(root, "plan"), theirs);
    await expect(ensureStarterFlow(root)).resolves.toBe(false);
    expect(writes).toEqual([]);
    expect(files.get(profilePath(root, "plan"))).toBe(theirs);
  });

  it("adds the flow once per workspace, so a deleted flow stays deleted", async () => {
    await ensureStarterFlow(root);
    for (const path of [...files.keys()]) files.delete(path);
    calls.length = 0;
    await expect(ensureStarterFlow(root)).resolves.toBe(false);
    expect(writes).toHaveLength(3);
    expect(calls).toEqual([]);
    expect(JSON.parse(store.get(STARTER_SEEDED_STORAGE_KEY)!)).toEqual([root]);
  });

  it("treats each workspace on its own", async () => {
    await ensureStarterFlow(root);
    await expect(ensureStarterFlow("/work/other")).resolves.toBe(true);
    expect(files.has(workflowPath("/work/other", STARTER_WORKFLOW_ID))).toBe(true);
  });

  it("shares one run between callers that arrive together", async () => {
    await expect(Promise.all([ensureStarterFlow(root), ensureStarterFlow(root)])).resolves.toEqual([true, true]);
    expect(writes).toHaveLength(3);
  });

  it("reports a failed write without giving up on the workspace", async () => {
    failWrites = true;
    await expect(ensureStarterFlow(root)).resolves.toBe(false);
    expect(store.has(STARTER_SEEDED_STORAGE_KEY)).toBe(false);

    failWrites = false;
    await expect(ensureStarterFlow(root)).resolves.toBe(true);
    expect(files.has(seededWorkflow)).toBe(true);
  });

  it("still works when storage is unavailable", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    await expect(ensureStarterFlow(root)).resolves.toBe(true);
    expect(files.has(seededWorkflow)).toBe(true);
  });
});
