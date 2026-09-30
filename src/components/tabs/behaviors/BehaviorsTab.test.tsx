// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { useWorkspaceStore } from "../../../store";
import { BehaviorsTab } from "./BehaviorsTab";
import { useWorkflowRunStore } from "./workflowRunStore";

const demo = {
  schema_version: 1,
  id: "demo",
  revision: 1,
  name: "Demo",
  rules: [{ id: "go-review", on: "BeforeModelRequest", do: { switch_profile: { profile: { id: "review" } } } }],
};
const workflow = {
  schema_version: 1,
  id: "flow",
  revision: 1,
  name: "Plan and build",
  nodes: [
    { id: "input", name: "Input", type: "input", config: { defaults: {} } },
    { id: "build", name: "Build", type: "agent", config: { instructions: "Do it", profile: { id: "demo" } } },
  ],
  edges: [{ id: "e1", source: "input", target: "build", condition: "on_success" }],
};

const files: Record<string, string> = {};
const written: Record<string, string> = {};

function setupFiles() {
  for (const key of Object.keys(files)) delete files[key];
  for (const key of Object.keys(written)) delete written[key];
  files["/ws/.rusty/profiles/demo.json"] = JSON.stringify(demo);
  files["/ws/.rusty/profiles/config.json"] = JSON.stringify({ default: { id: "demo" } });
  files["/ws/.rusty/workflows/flow.json"] = JSON.stringify(workflow);
}

async function flush(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim().startsWith(text));
  if (!found) throw new Error(`no button "${text}"`);
  return found as HTMLButtonElement;
}

function inputLabelled(container: HTMLElement, label: string): HTMLInputElement {
  const labelElement = [...container.querySelectorAll("label")].find((candidate) => candidate.textContent === label);
  if (!labelElement) throw new Error(`no field "${label}"`);
  return container.querySelector(`#${CSS.escape(labelElement.htmlFor)}`) as HTMLInputElement;
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("BehaviorsTab", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    setupFiles();
    invoke.mockReset();
    invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      switch (command) {
        case "get_directory_structure": {
          const dir = `${String(args.rootDir)}/`;
          return Object.keys(files)
            .filter((path) => path.startsWith(dir))
            .map((path) => ({ name: path.slice(dir.length), path, is_dir: false }));
        }
        case "read_file_disk": {
          const content = files[String(args.path)];
          if (content === undefined) throw new Error("not found");
          return content;
        }
        case "write_file_disk":
          written[String(args.path)] = String(args.content);
          files[String(args.path)] = String(args.content);
          return undefined;
        case "create_directory":
          return undefined;
        case "behavior_templates":
          return {
            builtin_profiles: [{ schema_version: 1, id: "rusty.default", revision: 1, name: "Default" }],
            default_workflow: { schema_version: 1, id: "rusty.single", nodes: [], edges: [] },
          };
        case "behavior_validate_profile":
          return (args.document as { id: string }).id === "demo"
            ? [{ path: "rules[0].do.switch_profile.profile", code: "unknown_profile", message: "no profile review@latest", blocking: true }]
            : [];
        case "behavior_validate_workflow":
          return [];
        default:
          throw new Error(`unexpected command ${command}`);
      }
    });
    useWorkspaceStore.setState({ rootPath: "/ws" });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<BehaviorsTab isActive />);
    });
    await flush();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("always offers the read-only built-in alongside project workflows", async () => {
    expect(inputLabelled(container, "Name").value).toBe("Plan, build, verify");
    expect(inputLabelled(container, "Name").matches(":disabled")).toBe(true);
    expect(button(container, "Customize a copy")).toBeDefined();
    expect(container.querySelector('[title="Delete file"]')).toBeNull();
    expect(Object.keys(written)).toEqual([]);
    await act(async () => button(container, "Plan and build").click());
    expect(button(container, "Plan and build").className).toMatch(/listItemActive/);
    expect(inputLabelled(container, "Name").value).toBe("Plan and build");
  });

  it("edits a profile, shows core validation, and saves it to .rusty/profiles", async () => {
    await act(async () => button(container, "Profiles").click());
    const item = button(container, "demo");
    expect(item.textContent).toContain("default");
    await act(async () => item.click());

    await flush(300);
    expect(item.querySelector('[title="Has validation issues"]')).not.toBeNull();
    expect(container.textContent).toContain("Rules");

    await act(async () => type(inputLabelled(container, "Name"), "Careful demo"));
    expect(button(container, "Save 1").disabled).toBe(false);
    await act(async () => button(container, "Save 1").click());
    await flush();

    const saved = JSON.parse(written["/ws/.rusty/profiles/demo.json"]);
    expect(saved.name).toBe("Careful demo");
    expect(saved.rules).toEqual(demo.rules);
    expect(button(container, "Saved").disabled).toBe(true);
  });

  it("drills from an agent step into its profile", async () => {
    await act(async () => button(container, "Plan and build").click());
    // Selecting the step goes through the canvas; drive the inspector path
    // the same way a click on the node would, via its drill button.
    const drill = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.startsWith("demo"));
    expect(drill).toBeDefined();
    await act(async () => drill!.click());
    expect(container.querySelector("nav")?.textContent).toContain("Plan and build");
    expect(container.querySelector("nav")?.textContent).toContain("Build");
    expect(inputLabelled(container, "Name").value).toBe("Demo");
  });

  it("hands a workflow to Agent Mode and shows its latest run on the canvas", async () => {
    await act(async () => button(container, "Plan and build").click());
    const openTab = vi.fn();
    useWorkspaceStore.setState({ openTab } as never);
    useWorkflowRunStore.setState({ agentRequest: undefined, runs: {} });
    await act(async () => type(inputLabelled(container, "Name"), "Renamed flow"));
    await flush(300);
    await act(async () => button(container, "Run in Agent Mode").click());
    await flush();

    expect(JSON.parse(written["/ws/.rusty/workflows/flow.json"]).name).toBe("Renamed flow");
    expect(useWorkflowRunStore.getState().agentRequest).toBe("/ws/.rusty/workflows/flow.json");
    expect(openTab).toHaveBeenCalledWith({ type: "agent" });

    await act(async () => {
      useWorkflowRunStore.getState().begin("flow");
      useWorkflowRunStore.getState().step("flow", { nodeId: "build", status: "failed", attempt: 1, message: "boom" });
      useWorkflowRunStore.getState().finish("flow", "failed", "Verification failed");
    });
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Last run failed");
    expect(container.textContent).toContain("Verification failed");
    expect(container.querySelector('[title="boom"]')?.textContent).toBe("failed");
  });

  it("opens the workflow an Agent chat asks to edit", async () => {
    await act(async () => button(container, "Profiles").click());
    await act(async () => {
      useWorkflowRunStore.getState().requestBehaviorsWorkflow("/ws/.rusty/workflows/flow.json");
    });
    await flush();
    expect(button(container, "Workflows").getAttribute("aria-selected")).toBe("true");
    expect(button(container, "Plan and build").className).toMatch(/listItemActive/);
    expect(useWorkflowRunStore.getState().behaviorsRequest).toBeUndefined();
  });
});
