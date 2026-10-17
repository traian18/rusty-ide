// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const flow = vi.hoisted(() => ({ lastProps: null as Record<string, any> | null }));
vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: Record<string, any>) => {
    flow.lastProps = props;
    return (
      <div data-testid="flow">
        {props.nodes.map((node: any) => (
          <div key={node.id}>
            <button
              data-testid={`node:${node.id}`}
              data-x={node.position.x}
              data-y={node.position.y}
              onClick={(event) => props.onNodeClick?.(event, node)}
              onDoubleClick={(event) => props.onNodeDoubleClick?.(event, node)}
            >
              {node.data.label}
            </button>
            <button data-testid={`drag:${node.id}`} onClick={(event) => props.onNodeDragStop?.(event, { ...node, position: { x: 111, y: 222 } })}>
              drag
            </button>
          </div>
        ))}
        {props.edges.map((edge: any) => (
          <span key={edge.id} data-testid={`edge:${edge.id}`}>
            {edge.label}
          </span>
        ))}
      </div>
    );
  },
  Handle: () => null,
  BaseEdge: () => null,
  Position: { Left: "left", Right: "right" },
  MarkerType: { ArrowClosed: "arrowclosed" },
  Background: () => null,
  BackgroundVariant: { Dots: "dots" },
  Controls: () => null,
  MiniMap: () => null,
  useStore: (selector: (state: { transform: number[] }) => unknown) => selector({ transform: [0, 0, 1] }),
  applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes,
}));

import { useWorkspaceStore } from "../store";
import type { GitRepository } from "../store/types";
import { ArchitectureTab } from "./ArchitectureTab";
import { groupKey } from "./identity";
import { useArchitectureView } from "./viewState";
import { fakeClient, findingEntry, findingsPage, group, levelNode, levelView, openResponse, ROOT, snapshot, type FakeClient } from "./testing";

let container: HTMLDivElement;
let root: Root;
const opened: Array<Record<string, unknown>> = [];

async function mount(client: FakeClient, node?: ReactNode) {
  await act(async () => {
    root.render(node ?? <ArchitectureTab client={client} root={ROOT} openFile={(tab) => opened.push(tab)} newId={() => "note-1"} loadLayoutEngine={async () => null} />);
  });
  await settle();
}

/** Lets pending promises (opens, queries) resolve and re-render. */
async function settle() {
  for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); });
}

const text = () => container.textContent ?? "";
const byTestId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const click = async (element: Element | null) => {
  expect(element).not.toBeNull();
  await act(async () => (element as HTMLElement).click());
  await settle();
};
/** Notices live in a dropdown; opens it when it is not open already. */
const openNotices = async () => {
  if (container.querySelector('[aria-label="Notices"]')) return;
  await click([...container.querySelectorAll("button")].find((button) => /^Notices \(/.test(button.textContent?.trim() ?? "")) ?? null);
};
/** Opens a compact select by its id and picks an option by its label. */
const pick = async (id: string, label: string) => {
  await click(container.querySelector(`#${id}`));
  await click([...document.querySelectorAll('[role="option"]')].find((option) => option.textContent === label) ?? null);
};
const buttonNamed = (name: string | RegExp) =>
  [...container.querySelectorAll("button")].find((button) => (typeof name === "string" ? button.textContent?.trim() === name : name.test(button.textContent ?? ""))) ?? null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  useArchitectureView.getState().reset();
  opened.length = 0;
  flow.lastProps = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("loading and the happy path", () => {
  it("shows a loading state, then the overview with badges and a freshness line", async () => {
    let finish!: (value: ReturnType<typeof openResponse>) => void;
    const client = fakeClient({ open: vi.fn(() => new Promise((resolve) => (finish = resolve))) as never });
    await mount(client);
    expect(text()).toContain("Loading repository");
    await act(async () => finish(openResponse()));
    await settle();
    expect(byTestId(`node:${groupKey("p:web")}`)).not.toBeNull();
    expect(byTestId("edge:p:web->p:core")).not.toBeNull();
    expect(text()).toContain("Built 2 min ago");
    expect(client.open).toHaveBeenCalledWith(ROOT);
    expect(client.architecture).toHaveBeenCalledWith(ROOT, { level: "packages", focus: null });
    expect(text()).not.toContain("Partial coverage");
  });

  it("asks for a workspace when none is open", async () => {
    await mount(fakeClient(), <ArchitectureTab client={fakeClient()} root="" />);
    expect(text()).toContain("Open a workspace");
  });
});

describe("states", () => {
  it("offers to analyze a workspace that has no snapshot, then shows the result", async () => {
    const client = fakeClient({ open: vi.fn(async () => openResponse({ snapshot: null, git: null, findings: null, built_at_ms: null })) });
    await mount(client);
    expect(text()).toContain("has not been analyzed yet");
    expect(client.architecture).not.toHaveBeenCalled();
    await click(buttonNamed("Analyze repository"));
    expect(client.refresh).toHaveBeenCalledWith(ROOT, true);
    expect(byTestId(`node:${groupKey("p:web")}`)).not.toBeNull();
  });

  it("explains an empty workspace", async () => {
    await mount(fakeClient({ open: vi.fn(async () => openResponse({ snapshot: snapshot({ files: 0, packages: 0 }) })) }));
    expect(text()).toContain("No supported source files were found");
  });

  it("reports an open failure and retries", async () => {
    const open = vi.fn().mockRejectedValueOnce({ code: "invalid_request", message: "root is not usable" }).mockResolvedValue(openResponse());
    const client = fakeClient({ open });
    await mount(client);
    expect(text()).toContain("Could not open the repository");
    expect(text()).toContain("root is not usable");
    await click(buttonNamed("Try again"));
    expect(open).toHaveBeenCalledTimes(2);
    expect(byTestId(`node:${groupKey("p:web")}`)).not.toBeNull();
  });

  it("reports a view that fails to load", async () => {
    await mount(fakeClient({ architecture: vi.fn(async () => { throw { code: "dependency_failure", message: "disk unavailable" }; }) }));
    await openNotices();
    expect(text()).toContain("Could not load this view");
    expect(text()).toContain("disk unavailable");
  });

  it("shows partial coverage with a diagnostics list on demand", async () => {
    const diagnostics = [{ path: "src/big.rs", message: "source exceeds configured import byte limit" }];
    await mount(fakeClient({ open: vi.fn(async () => openResponse({ snapshot: snapshot({ partial: true, diagnostics_total: 3, diagnostics }) })) }));
    await openNotices();
    expect(text()).toContain("Partial coverage");
    expect(text()).not.toContain("exceeds configured import byte limit");
    await click(buttonNamed("Show diagnostics"));
    expect(text()).toContain("src/big.rs");
    expect(text()).toContain("exceeds configured import byte limit");
    expect(text()).toContain("and 2 more");
  });

  it("keeps notices out of the way until the menu is opened, and closes it on Escape", async () => {
    await mount(fakeClient({ open: vi.fn(async () => openResponse({ snapshot: snapshot({ partial: true, diagnostics_total: 1, diagnostics: [] }) })) }));
    expect(text()).not.toContain("Partial coverage");
    expect(text()).toContain("Notices (");
    await openNotices();
    expect(text()).toContain("Partial coverage");
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(text()).not.toContain("Partial coverage");
  });

  it("warns when files changed since the analysis and refreshes on request", async () => {
    const client = fakeClient({ freshness: vi.fn(async () => ({ built_at_ms: 1, checked: 6, changed: ["src/a.ts", "src/b.ts"], missing: ["src/old.ts"] })) });
    await mount(client);
    await openNotices();
    expect(text()).toContain("The repository changed since it was analyzed");
    expect(text()).toContain("2 files changed, 1 removed since");
    await click([...container.querySelectorAll("button")].filter((b) => b.textContent === "Refresh").pop() ?? null);
    expect(client.refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps showing the previous results when a refresh fails", async () => {
    const client = fakeClient({ refresh: vi.fn(async () => { throw { code: "cancelled", message: "the operation was cancelled" }; }) });
    await mount(client);
    await click(buttonNamed("Refresh"));
    await openNotices();
    expect(text()).toContain("Analysis failed");
    expect(byTestId(`node:${groupKey("p:web")}`)).not.toBeNull();
  });

  it("surfaces a missing Git history without failing the analysis", async () => {
    const client = fakeClient({
      refresh: vi.fn(async () => ({ snapshot: snapshot(), git: null, findings: openResponse().findings, built_at_ms: Date.now(), stage_errors: [{ stage: "git", code: "not_a_git_repository", message: "not a git repository" }] })),
    });
    await mount(client);
    await click(buttonNamed("Refresh"));
    await openNotices();
    expect(text()).toContain("Git history unavailable");
  });

  it("tells the person when the graph was truncated", async () => {
    await mount(fakeClient({ architecture: vi.fn(async () => levelView({ nodes_truncated: true })) }));
    await openNotices();
    expect(text()).toContain("node limit");
  });

  it("listens for workspace changes and checks freshness without scanning", async () => {
    let notify!: () => void;
    vi.useFakeTimers();
    const client = fakeClient({ onWorkspaceChanged: vi.fn(async (callback) => { notify = callback; return () => undefined; }) });
    await mount(client);
    const before = client.freshness.mock.calls.length;
    notify();
    await act(async () => { vi.advanceTimersByTime(900); });
    vi.useRealTimers();
    expect(client.freshness.mock.calls.length).toBe(before + 1);
    expect(client.refresh).not.toHaveBeenCalled();
  });
});

describe("filtering", () => {
  const many = Array.from({ length: 20 }, (_, i) => levelNode(`p:${i}`, i % 2 ? `lib-${i}` : `app-${i}`));

  it("filters nodes by search and reports what is hidden, with a way back", async () => {
    await mount(fakeClient({ architecture: vi.fn(async () => levelView({ nodes: many, edges: [], total_nodes: 20 })) }));
    expect(container.querySelectorAll('[data-testid^="node:group:p:"]').length).toBe(20);
    const search = container.querySelector('input[type="search"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(search, "app-1");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    const shown = container.querySelectorAll('[data-testid^="node:group:p:"]').length;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(20);
    expect(text()).toContain(`${20 - shown} hidden by filters`);

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "zzz-no-match");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    expect(text()).toContain("Nothing matches the current filters");
    await click(buttonNamed("Clear filters"));
    expect(container.querySelectorAll('[data-testid^="node:group:p:"]').length).toBe(20);
  });
});

describe("read-only canvas", () => {
  it("cannot connect or delete, and dragging only saves a position", async () => {
    const client = fakeClient();
    await mount(client);
    expect(flow.lastProps).toMatchObject({ nodesConnectable: false, deleteKeyCode: null, edgesFocusable: false });
    expect(flow.lastProps).not.toHaveProperty("onConnect");
    expect(flow.lastProps).not.toHaveProperty("onEdgesDelete");
    expect(flow.lastProps).not.toHaveProperty("onNodesDelete");
    expect(flow.lastProps!.nodes.every((node: any) => node.connectable === false && node.deletable === false)).toBe(true);

    await click(byTestId(`drag:${groupKey("p:web")}`));
    await act(async () => root.unmount()); // unmounting flushes the pending save
    expect(client.saveState).toHaveBeenCalled();
    const saved = client.saveState.mock.calls.at(-1)![1] as { layouts: Record<string, Record<string, { x: number; y: number }>> };
    expect(saved.layouts["level:"][groupKey("p:web")]).toEqual({ x: 111, y: 222 });
    root = createRoot(container);
  });

  it("restores saved positions after a refresh", async () => {
    const document = { version: 1, layouts: { "level:": { [groupKey("p:web")]: { x: 5, y: 7 } } }, view: { importKind: "all", colorMode: "node", edgeCoverage: 80 }, notes: [] };
    const client = fakeClient({ loadState: vi.fn(async () => document) });
    await mount(client);
    expect(byTestId(`node:${groupKey("p:web")}`)).toMatchObject({ dataset: { x: "5", y: "7" } });
    await click(buttonNamed("Refresh"));
    expect(byTestId(`node:${groupKey("p:web")}`)).toMatchObject({ dataset: { x: "5", y: "7" } });
  });
});

describe("drill-down, inspector, and navigation", () => {
  /** Opens the files of the "web" package, as double-clicking its component would. */
  async function drillIntoWeb(client: FakeClient) {
    await mount(client);
    await act(async () => useArchitectureView.getState().open({ id: "p:web", label: "web" }));
    await settle();
  }

  it("opens a group's files and returns to the level it came from", async () => {
    const client = fakeClient();
    await drillIntoWeb(client);
    expect(client.groupGraph).toHaveBeenCalledWith(ROOT, { group: "p:web" });
    expect(byTestId("node:file:src/a.ts")).not.toBeNull();
    expect(byTestId("edge:src/a.ts->src/b.ts")).not.toBeNull();
    await click(buttonNamed("Up"));
    expect(byTestId(`node:${groupKey("p:core")}`)).not.toBeNull();
  });

  it("explains a selected group", async () => {
    await mount(fakeClient());
    await click(byTestId(`node:${groupKey("p:core")}`));
    expect(text()).toContain("core is declared by a manifest.");
    expect(text()).toContain("Declared by a manifest");
  });

  it("shows a file's relationships, findings, and history, and opens exact locations in the editor", async () => {
    const client = fakeClient({
      groupsOf: vi.fn(async () => [{ group: group("p:web", "web"), evidence: [], cycle_sites: [], evidence_truncated: false }]),
      gitFile: vi.fn(async () => ({
        git_snapshot: "git-1",
        churn: { file: "src/a.ts", commits: 4, lines_added: 10, lines_removed: 2, contributors: 1, first_change: 1, last_change: 1_700_000_000, absent_at_head: false },
        co_changed: [{ partner: "src/b.ts", support: 4, file_commits: 4, confidence_per_mille: 1000 }],
        contributors: [{ contributor: { id: "c", name: "Alice" }, commits: 4, commit_share_per_mille: 1000 }],
        interpretation: "Historical correlation only.",
      })),
    });
    await drillIntoWeb(client);
    await click(byTestId("node:file:src/a.ts"));
    expect(client.groupsOf).toHaveBeenCalledWith(ROOT, "src/a.ts");
    expect(text()).toContain("Import cycle between 2 files");
    expect(text()).toContain("4 commits");
    expect(text()).toContain("Alice (100%)");
    expect(text()).toContain("Historical correlation only.");
    await click(buttonNamed("Line 3"));
    expect(opened).toEqual([{ type: "file", path: "/ws/src/a.ts", line: 3 }]);
  });

  it("opens a stale location at the top of the file and says why", async () => {
    const stale = findingEntry({ locations: [{ file: "src/a.ts", start: 4, end: 20, line: null, column: null, stale: true }] });
    await drillIntoWeb(fakeClient({ findings: vi.fn(async () => findingsPage([stale])) }));
    await click(byTestId("node:file:src/a.ts"));
    await click(buttonNamed(/Open file \(file changed\)/));
    expect(opened).toEqual([{ type: "file", path: "/ws/src/a.ts" }]);
    await openNotices();
    expect(text()).toContain("changed since the analysis");
  });

  it("handles a group that disappeared after a refresh", async () => {
    const client = fakeClient();
    await drillIntoWeb(client);
    client.groupGraph.mockRejectedValue({ code: "unknown_group", message: "unknown group: p:web" });
    await click(buttonNamed("Refresh"));
    expect(text()).toContain("Could not load this view");
    await click(buttonNamed("Back"));
    expect(byTestId(`node:${groupKey("p:core")}`)).not.toBeNull();
  });
});

describe("findings panel", () => {
  it("lists findings with their candidate caveat and explains one on demand", async () => {
    const candidate = findingEntry({ id: "unreferenced-file:src/old.ts", rule: { id: "unreferenced-file", version: 1 }, kind: "candidate", severity: "low", confidence: "low", title: "src/old.ts may be unreferenced", interpretation: "A candidate from heuristics; it is not evidence that the code is unused." });
    const client = fakeClient({
      findings: vi.fn(async () => findingsPage([findingEntry(), candidate])),
      findingExplain: vi.fn(async () => ({ entry: candidate, rule_description: "Indexed files nothing imports.", import_sites: [], repository_snapshot_available: true })),
    });
    await mount(client);
    await click([...container.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === "Findings") ?? null);
    expect(text()).toContain("Candidate · low confidence");
    // The summary strip repeats the title; the explain button is the one in the panel.
    await click([...container.querySelectorAll("button")].filter((b) => b.textContent === "src/old.ts may be unreferenced").pop() ?? null);
    expect(client.findingExplain).toHaveBeenCalledWith(ROOT, "unreferenced-file:src/old.ts");
    expect(text()).toContain("not evidence that the code is unused");
    expect(text()).toContain("Indexed files nothing imports.");
  });

  it("passes filters to the host and shows the empty state", async () => {
    const findings = vi.fn(async (_root: string, _request: Record<string, unknown>) => findingsPage([]));
    const client = fakeClient({ findings });
    await mount(client);
    await click([...container.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === "Findings") ?? null);
    expect(text()).toContain("No findings match");
    const kind = container.querySelector('select[aria-label="Finding kind"]') as HTMLSelectElement;
    await act(async () => {
      kind.value = "candidate";
      kind.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(findings.mock.calls.at(-1)![1]).toMatchObject({ kind: "candidate" });
  });
});

describe("notes", () => {
  it("adds a note to the selected node and saves it apart from the graph", async () => {
    const client = fakeClient();
    await mount(client);
    await click(byTestId(`node:${groupKey("p:web")}`));
    await click([...container.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === "Notes") ?? null);
    const area = container.querySelector('textarea[aria-label="New note"]') as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, "check ownership");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(buttonNamed("Add note"));
    expect(text()).toContain("Your note");
    await act(async () => root.unmount());
    const saved = client.saveState.mock.calls.at(-1)![1] as { notes: { node: string; text: string }[] };
    expect(saved.notes).toEqual([expect.objectContaining({ node: groupKey("p:web"), text: "check ownership" })]);
    root = createRoot(container);
  });

  it("keeps notes whose node vanished and lists them as orphaned", async () => {
    const document = {
      version: 1, layouts: {}, view: { importKind: "all", colorMode: "node", edgeCoverage: 80 },
      notes: [
        { id: "n1", node: groupKey("p:web"), text: "still here", created: 1, updated: 1 },
        { id: "n2", node: "file:gone.ts", text: "lost its file", created: 1, updated: 1 },
      ],
    };
    const client = fakeClient({
      loadState: vi.fn(async () => document),
      nodesExist: vi.fn(async () => ({ groups: ["p:web"], files: [] })),
    });
    await mount(client);
    await click([...container.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === "Notes") ?? null);
    expect(text()).toContain("Orphaned notes (1)");
    expect(text()).toContain("lost its file");
    expect(text()).toContain("kept until you delete them");
    // Nothing was removed from the saved document.
    await act(async () => root.unmount());
    const calls = client.saveState.mock.calls;
    if (calls.length) expect((calls.at(-1)![1] as { notes: unknown[] }).notes).toHaveLength(2);
    root = createRoot(container);
  });

  it("warns, rather than failing, when saved data is unreadable", async () => {
    await mount(fakeClient({ loadState: vi.fn(async () => ({ version: 99 })) }));
    await openNotices();
    expect(text()).toContain("different version");
    expect(byTestId(`node:${groupKey("p:web")}`)).not.toBeNull();
  });

  it("flags a save that failed without losing the canvas", async () => {
    vi.useFakeTimers();
    const client = fakeClient({ saveState: vi.fn(async () => { throw { code: "io_error", message: "disk full" }; }) });
    await mount(client);
    await click(byTestId(`drag:${groupKey("p:web")}`));
    await act(async () => { vi.advanceTimersByTime(600); });
    vi.useRealTimers();
    await settle();
    expect(client.saveState).toHaveBeenCalled();
    await openNotices();
    expect(text()).toContain("could not be saved");
    expect(byTestId(`node:${groupKey("p:web")}`)).not.toBeNull();
  });
});

describe("repository selection", () => {
  const repo = (worktreePath: string): GitRepository => ({
    id: worktreePath, worktreePath, gitDir: `${worktreePath}/.git`, kind: "workspace", parentId: null, submodulePath: null, initialized: true,
    head: { mode: "unborn" } as unknown as GitRepository["head"], submoduleState: null,
  });
  const before = useWorkspaceStore.getState();
  afterEach(() => useWorkspaceStore.setState({ rootPath: before.rootPath, repositories: before.repositories, activeRepositoryId: before.activeRepositoryId }));
  const tab = (client: FakeClient) => <ArchitectureTab client={client} openFile={() => undefined} loadLayoutEngine={async () => null} />;
  const choose = (label: string) => pick("architecture-repository", label);

  it("analyses only the selected repository and switches with the selector, sharing the choice with the Git sidebar", async () => {
    useWorkspaceStore.setState({ rootPath: "/ws", repositories: [repo("/ws/api"), repo("/ws/web")], activeRepositoryId: "/ws/api" });
    const client = fakeClient();
    await mount(client, tab(client));
    expect(client.open).toHaveBeenCalledTimes(1);
    expect(client.open).toHaveBeenCalledWith("/ws/api");
    await click(container.querySelector("#architecture-repository"));
    expect([...document.querySelectorAll('[role="option"]')].map((o) => o.textContent)).toEqual(["api", "web"]);
    await click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent === "api") ?? null);

    await choose("web");
    expect(client.open).toHaveBeenLastCalledWith("/ws/web");
    expect(useWorkspaceStore.getState().activeRepositoryId).toBe("/ws/web");
    expect(client.architecture).toHaveBeenLastCalledWith("/ws/web", { level: "packages", focus: null });
  });

  it("falls back to the first repository when none is chosen yet, and shows no selector for a single repository", async () => {
    useWorkspaceStore.setState({ rootPath: "/ws", repositories: [repo("/ws/only")], activeRepositoryId: null });
    const client = fakeClient();
    await mount(client, tab(client));
    expect(client.open).toHaveBeenCalledWith("/ws/only");
    expect(container.querySelector("#architecture-repository")).toBeNull();
  });

  it("uses the workspace folder itself when no repositories were discovered", async () => {
    useWorkspaceStore.setState({ rootPath: "/plain", repositories: [], activeRepositoryId: null, discoverRepositories: async () => undefined });
    const client = fakeClient();
    await mount(client, tab(client));
    expect(client.open).toHaveBeenCalledWith("/plain");
  });

  it("starts the next repository from its own view, not the previous one's", async () => {
    useWorkspaceStore.setState({ rootPath: "/ws", repositories: [repo("/ws/api"), repo("/ws/web")], activeRepositoryId: "/ws/api" });
    const client = fakeClient();
    await mount(client, tab(client));
    await act(async () => useArchitectureView.getState().open({ id: "p:web", label: "web" }));
    await choose("web");
    expect(useArchitectureView.getState()).toMatchObject({ trail: [] });
  });
});
