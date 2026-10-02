// @vitest-environment jsdom
import { act, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CompletionGateFields, ToolOverrides } from "./ProfileConfigFields";
import { ConditionEditor } from "./ConditionEditor";
import { ValueFields } from "./ValueFields";
import { ProfileInspector } from "./ProfileInspector";
import type { Json, JsonObject } from "./behaviorModel";
import { STARTER_PROFILES } from "./starterFlow";
import { PROFILE_TOOLS } from "./ToolSelector";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let saved: Json | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
function mount(initial: Json | undefined, view: (value: Json | undefined, change: (value: Json | undefined) => void) => ReactNode) {
  function Editor() { const [value, change] = useState(initial); saved = value; return view(value, change); }
  act(() => root.render(<Editor />));
}
async function choose(label: string, option: string) {
  const group = host.querySelector(`[aria-label="${label}"]`)!;
  await act(async () => group.querySelector<HTMLButtonElement>("button")!.click());
  const item = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find((entry) => entry.textContent === option)!;
  expect(item).toBeDefined();
  await act(async () => item.click());
}
function type(label: string, text: string) {
  const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!;
  const prototype = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => { Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, text); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

it("edits tool permissions and instructions without replacing other overrides", async () => {
  mount({ read_file: { permission: "ask", description_append: "Read carefully" }, "mcp.custom.*": { permission: "deny" } },
    (value, change) => <ToolOverrides value={value} onChange={change} />);
  await choose("read_file permission", "Deny");
  type("read_file extra instructions", "Check file size first");
  expect(saved).toEqual({ read_file: { permission: "deny", description_append: "Check file size first" }, "mcp.custom.*": { permission: "deny" } });
  await choose("Add tool settings", "Run Commands");
  expect((saved as JsonObject).run_command).toEqual({});
});

it("edits nested completion requirements while retaining sibling conditions and metadata", () => {
  const require: JsonObject = { all: [{ calls: { tool: ["read_file"], gte: 1, lte: 5 } }, { not: { tool: "write_file" } }] };
  mount(require, (value, change) => <ConditionEditor value={value} onChange={change} profileIds={[]} />);
  type("Condition 1 At least", "2");
  expect(saved).toEqual({ all: [{ calls: { tool: ["read_file"], gte: 2, lte: 5 } }, { not: { tool: "write_file" } }] });
});

it("edits which calls a count looks at, and leaves the outcome out of the saved condition when it is any", async () => {
  mount({ since_last_call: { of: ["write_file"], called: ["run_check"], gte: 1 } },
    (value, change) => <ConditionEditor value={value} onChange={change} profileIds={[]} />);
  await choose("Condition outcome", "Succeeded");
  expect(saved).toEqual({ since_last_call: { of: ["write_file"], called: ["run_check"], gte: 1, outcome: "succeeded" } });
  await choose("Condition outcome", "Failed (the tool reported an error)");
  expect((saved as JsonObject).since_last_call).toMatchObject({ outcome: "failed", of: ["write_file"], called: ["run_check"], gte: 1 });
  await choose("Condition outcome", "Ran (any result)");
  expect(saved).toEqual({ since_last_call: { of: ["write_file"], called: ["run_check"], gte: 1 } });
});

it("offers the outcome filter for call counts and turns since a call, but not for other conditions", () => {
  for (const condition of ([{ calls: { tool: ["run_check"], gte: 1 } }, { turns_since_call: { tool: ["run_check"], gte: 2 } }] as Json[])) {
    mount(condition, (value, change) => <ConditionEditor value={value} onChange={change} profileIds={[]} />);
    expect(host.querySelector('[aria-label="Condition outcome"]')).not.toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
  }
  mount({ turn: { gte: 2 } }, (value, change) => <ConditionEditor value={value} onChange={change} profileIds={[]} />);
  expect(host.querySelector('[aria-label="Condition outcome"]')).toBeNull();
});

it("adds a 'tool is available' condition that starts on run_check, and keeps an edited one", async () => {
  mount(undefined, (value, change) => <ConditionEditor value={value} onChange={change} profileIds={[]} optional />);
  await choose("Condition", "A tool is available to the agent");
  expect(saved).toEqual({ tool_offered: ["run_check"] });
  expect(host.textContent).toContain("Run Project Checks");
  const boxes = [...host.querySelectorAll<HTMLInputElement>('[aria-label="Allowed tools"] input[type="checkbox"]')];
  expect(boxes.filter((box) => box.checked)).toHaveLength(1);
});

it("keeps a saved gate that combines the new condition and filter readable instead of treating it as unsupported", () => {
  const gate: JsonObject = { any: [{ calls: { tool: "write_file", eq: 0 } }, { not: { tool_offered: "run_check" } },
    { since_last_call: { of: "write_file", called: "run_check", outcome: "succeeded", gte: 1 } }] };
  mount(gate, (value, change) => <ConditionEditor value={value} onChange={change} profileIds={[]} />);
  expect(host.textContent).not.toContain("not supported by this version");
  expect(saved).toEqual(gate);
});

it("lets every tool the built-in profiles name be picked, not shown as a saved custom tool", () => {
  const known = new Set(PROFILE_TOOLS.map((tool) => tool.id));
  for (const id of ["edit_file", "project_info", "run_check", "install_dependencies", "web_extract"]) expect(known.has(id)).toBe(true);
  for (const profile of STARTER_PROFILES) {
    const tools = profile.tools as JsonObject;
    const listed = tools.type === "allow_list" ? (tools.tools as string[]) : [];
    const overridden = Object.keys((profile.tool_overrides ?? {}) as JsonObject);
    for (const id of [...listed, ...overridden]) expect(known.has(id), `${profile.id} names ${id}`).toBe(true);
  }
});

it("switches a completion check to a model reviewer without conflicting condition fields", async () => {
  mount({ checks: [{ id: "ready", require: { calls: { tool: "read_file", gte: 1 } }, feedback: "Try again", metadata: { note: "keep" } }], max_continuations: 2, on_exhausted: "fail" },
    (value, change) => <CompletionGateFields value={value} onChange={change} profileIds={[]} />);
  await choose("Check 1 method", "Ask a model");
  type("Review instructions", "Verify the acceptance criteria");
  const check = ((saved as JsonObject).checks as JsonObject[])[0];
  expect(check.require).toBeUndefined();
  expect(check.evaluator).toEqual({ type: "model", instructions: "Verify the acceptance criteria" });
  expect(check.metadata).toEqual({ note: "keep" });
  expect(check.feedback).toBe("Try again");
  expect((saved as JsonObject).max_continuations).toBe(2);
});

it("edits typed nested tool arguments without asking for JSON", () => {
  mount({ options: { retries: 2 }, obsolete: null, tags: ["a"] },
    (value, change) => <ValueFields label="Arguments" value={value!} onChange={change} />);
  type("Arguments options retries", "4");
  expect(saved).toEqual({ options: { retries: 4 }, obsolete: null, tags: ["a"] });
});

it("renders the built-in profile with structured controls and keeps it read-only", () => {
  act(() => root.render(<ProfileInspector profile={STARTER_PROFILES.find((profile) => profile.id === "rusty-ide.builtin.build")!} readOnly issues={[]} profileIds={[]} isDefault={false} onChange={vi.fn()} onSetDefault={vi.fn()} />));
  expect(host.textContent).toContain("Per-tool settings");
  expect(host.textContent).toContain("Additional attempts");
  expect([...host.querySelectorAll("textarea")].some((input) => input.value.trim().startsWith("{"))).toBe(false);
  const permission = host.querySelector('[aria-label="write_file permission"] button')!;
  expect(permission.matches(":disabled")).toBe(true);
});
