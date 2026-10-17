// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import ELK from "elkjs/lib/elk.bundled.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@xyflow/react", async () => (await import("./flowStub")).flowStub);

import { ArchitectureTab } from "./ArchitectureTab";
import { flowState } from "./flowStub";
import { groupKey } from "./identity";
import type { ElkLike } from "./layoutElk";
import { fakeClient, levelNode, levelView, openResponse, ROOT, snapshot, type FakeClient } from "./testing";
import { useArchitectureView } from "./viewState";

let container: HTMLDivElement;
let root: Root;
const realElk = new ELK() as unknown as ElkLike;

async function settle() {
  for (let i = 0; i < 12; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
async function mount(client: FakeClient, loader: () => Promise<ElkLike | null> = async () => realElk) {
  await act(async () => {
    root.render(<ArchitectureTab client={client} root={ROOT} openFile={() => undefined} loadLayoutEngine={loader} />);
  });
  await settle();
}
const text = () => container.textContent ?? "";
const node = (id: string) => container.querySelector(`[data-testid="node:${groupKey(id)}"]`) as HTMLElement | null;
const edge = (id: string) => container.querySelector(`[data-testid="edge:${id}"]`) as HTMLElement | null;
const click = async (element: Element | null) => {
  expect(element).not.toBeNull();
  await act(async () => (element as HTMLElement).click());
  await settle();
};
const doubleClick = async (element: Element | null) => {
  expect(element).not.toBeNull();
  await act(async () => element!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  await settle();
};
/** Opens a compact select by its id and picks an option by its label. */
const pick = async (id: string, label: string) => {
  await click(container.querySelector(`#${id}`));
  await click([...document.querySelectorAll('[role="option"]')].find((option) => option.textContent === label) ?? null);
};
const buttonNamed = (name: string) => [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === name) ?? null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  useArchitectureView.getState().reset();
  flowState.lastProps = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/** Packages whose web package holds one component, so opening it shows that level rather than its files. */
const packagesWithComponents = () =>
  levelView({
    nodes: [
      levelNode("p:web", "web", { children: [{ id: "dir:web/src/ui", label: "ui", file_count: 3, has_children: false }] }),
      levelNode("p:core", "core", { languages: { rust: 3 } }),
    ],
  });
const clientWith = (view = levelView()) => fakeClient({ loadState: vi.fn(async () => null), architecture: vi.fn(async () => view) });

describe("the levelled view", () => {
  it("opens on the top of the tree with a summary, a breadcrumb and a legend", async () => {
    const client = clientWith();
    await mount(client);
    expect(client.architecture).toHaveBeenCalledWith(ROOT, { level: "packages", focus: null });
    expect(node("p:web")).not.toBeNull();
    const summary = container.querySelector('[aria-label="Repository summary"]')!.textContent!;
    expect(summary).toContain("2 packages");
    expect(summary).toContain("import cycles");
    expect(container.querySelector('nav[aria-label="Architecture level"]')!.textContent).toContain("ws");
    expect(container.querySelector('[aria-label="Legend"]')!.textContent).toContain("own colour");
  });

  it("colours every package differently and starts each line in the colour of the package it comes from", async () => {
    await mount(clientWith());
    const band = edge("p:web->p:core")!;
    expect(band.dataset.type).toBe("arch-band");
    expect(band.dataset.from).toMatch(/^var\(--color-category-\d+\)$/);
    expect(band.dataset.to).toMatch(/^var\(--color-category-\d+\)$/);
    expect(band.dataset.from).not.toBe(band.dataset.to);
  });

  it("can colour by language instead, with a legend of the languages", async () => {
    await mount(clientWith());
    await pick("architecture-colour", "Language");
    expect(container.querySelector('[aria-label="Legend"]')!.textContent).toMatch(/typescript/);
    expect(edge("p:web->p:core")!.dataset.from).not.toMatch(/category/);
  });

  it("lays nodes out in layers and sizes boxes by file count", async () => {
    await mount(clientWith());
    const web = node("p:web")!;
    const core = node("p:core")!;
    expect(Number(web.dataset.x)).toBeLessThan(Number(core.dataset.x));
  });

  it("shows an edge's count only while one of its nodes is selected", async () => {
    await mount(clientWith());
    expect(edge("p:web->p:core")!.textContent).toBe("");
    await click(node("p:web"));
    expect(edge("p:web->p:core")!.textContent).toBe("3 imports (1 type-only)");
  });

  it("folds the least connected packages beyond the level's cap and says so", async () => {
    const nodes = Array.from({ length: 50 }, (_, i) => levelNode(`p:${String(i).padStart(2, "0")}`, `pkg${i}`));
    await mount(clientWith(levelView({ nodes, edges: [], total_nodes: 50 })));
    expect(container.querySelectorAll('[data-testid^="node:group:p:"]').length).toBe(39);
    expect(node("fold:more")!.textContent).toBe("+11 more");
    expect(text()).toContain("11 less connected nodes folded");
  });

  it("draws every edge by default, and the slider can thin them out and bring them back", async () => {
    const nodes = ["a", "b", "c"].map((id) => levelNode(id, id));
    const edges = [
      { from: "a", to: "b", runtime: 90, type_only: 0, in_cycle: false },
      { from: "b", to: "c", runtime: 5, type_only: 0, in_cycle: false },
      { from: "a", to: "c", runtime: 5, type_only: 0, in_cycle: false },
    ];
    await mount(clientWith(levelView({ nodes, edges })));
    expect(edge("b->c")).not.toBeNull();
    expect(text()).not.toContain("weaker edges hidden");
    const slider = container.querySelector('input[aria-label="Share of import weight shown"]') as HTMLInputElement;
    expect(slider.value).toBe("100");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(slider, "80");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    expect(text()).toContain("2 of 3 weaker edges hidden");
    expect(edge("b->c")).toBeNull();
  });

  it("always draws cycle edges, in red, however light", async () => {
    const nodes = ["a", "b", "c"].map((id) => levelNode(id, id));
    const edges = [
      { from: "a", to: "b", runtime: 90, type_only: 0, in_cycle: false },
      { from: "b", to: "c", runtime: 1, type_only: 0, in_cycle: true },
    ];
    await mount(clientWith(levelView({ nodes, edges })));
    expect(edge("b->c")!.dataset.cycle).toBe("yes");
  });

  it("opens a node whose folder has no folders straight to its files", async () => {
    const client = fakeClient({ loadState: vi.fn(async () => null), architecture: vi.fn(async (_r, request) => (request.focus ? levelView({ level: "components", focus: request.focus, leaf: true }) : packagesWithComponents())) });
    await mount(client);
    await doubleClick(node("p:web"));
    expect(client.architecture).toHaveBeenLastCalledWith(ROOT, { level: "components", focus: "p:web" });
    expect(client.groupGraph).toHaveBeenCalledWith(ROOT, { group: "p:web" });
    expect(useArchitectureView.getState().trail).toEqual([{ id: "p:web", label: "web" }]);
  });

  it("shows one level at a time and climbs back by the breadcrumb or Up", async () => {
    const components = levelView({
      level: "components", focus: "p:web",
      nodes: [levelNode("dir:web/src/ui", "ui", { kind: "directory", basis: "inferred" }), levelNode("rest:p:web", "Loose files", { synthetic: true, basis: null, kind: "directory" })],
      edges: [],
    });
    const client = fakeClient({
      loadState: vi.fn(async () => null),
      architecture: vi.fn(async (_root, request) =>
        request.focus === "p:web" ? components : request.focus ? levelView({ level: "components", focus: request.focus, leaf: true }) : packagesWithComponents()),
    });
    await mount(client);
    await doubleClick(node("p:web"));
    expect(node("dir:web/src/ui")).not.toBeNull();
    expect(container.querySelector('nav[aria-label="Architecture level"]')!.textContent).toContain("web");

    // The files that sit in none of the folders open like any other group.
    await doubleClick(node("rest:p:web"));
    expect(client.groupGraph).toHaveBeenCalledWith(ROOT, { group: "rest:p:web" });
    await click(buttonNamed("Up"));
    expect(node("dir:web/src/ui")).not.toBeNull();

    await doubleClick(node("dir:web/src/ui"));
    expect(client.groupGraph).toHaveBeenCalledWith(ROOT, { group: "dir:web/src/ui" });
    expect(container.querySelector('nav[aria-label="Architecture level"]')!.textContent).toContain("ui");

    await click(buttonNamed("ws"));
    expect(client.architecture).toHaveBeenLastCalledWith(ROOT, { level: "packages", focus: null });
    expect(node("p:web")).not.toBeNull();
    expect(useArchitectureView.getState().trail).toEqual([]);
  });

  it("filters nodes by name and by findings", async () => {
    await mount(clientWith());
    const search = container.querySelector('input[type="search"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "core");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    expect(node("p:web")).toBeNull();
    expect(node("p:core")).not.toBeNull();
    expect(text()).toContain("1 hidden by filters");
  });

  it("switches colouring and shows the matching legend", async () => {
    await mount(clientWith());
    await pick("architecture-colour", "Findings severity");
    expect(container.querySelector('[aria-label="Legend"]')!.textContent).toContain("High findings");
    await pick("architecture-colour", "Kind");
    expect(container.querySelector('[aria-label="Legend"]')!.textContent).toContain("Source root");
  });

  it("falls back to a simple layout, and says so, when no layout engine loads", async () => {
    await mount(clientWith(), async () => null);
    expect(node("p:web")).not.toBeNull();
    expect(text()).toContain("simple layout in use");
  });

  it("reports node truncation from the host", async () => {
    await mount(clientWith(levelView({ nodes_truncated: true, total_nodes: 900 })));
    await click([...container.querySelectorAll("button")].find((button) => /^Notices \(/.test(button.textContent?.trim() ?? "")) ?? null);
    expect(text()).toMatch(/limit/i);
  });

  it("keeps a dragged position over the computed layout", async () => {
    const client = clientWith();
    await mount(client);
    await act(async () => flowState.lastProps!.onNodeDragStop({}, { id: groupKey("p:web"), position: { x: 321, y: 123 } }));
    await act(async () => root.unmount());
    const saved = client.saveState.mock.calls.at(-1)![1] as { layouts: Record<string, Record<string, { x: number; y: number }>> };
    expect(saved.layouts["level:"][groupKey("p:web")]).toEqual({ x: 321, y: 123 });
    root = createRoot(container);
  });

  describe("coming back to the tab", () => {
    const remount = async (client: FakeClient, rootPath = ROOT) => {
      await act(async () => root.unmount());
      root = createRoot(container);
      await act(async () => {
        root.render(<ArchitectureTab client={client} root={rootPath} openFile={() => undefined} loadLayoutEngine={async () => realElk} />);
      });
      await settle();
    };
    const components = levelView({ level: "components", focus: "p:web", nodes: [levelNode("dir:web/ui", "ui", { kind: "directory" })], edges: [] });
    const clientForLevels = () => fakeClient({ loadState: vi.fn(async () => null), architecture: vi.fn(async (_r, request) => (request.level === "components" ? components : packagesWithComponents())) });

    it("is exactly as it was: same level, selection, filter and panel", async () => {
      const client = clientForLevels();
      await mount(client);
      await doubleClick(node("p:web"));
      await click(node("dir:web/ui"));
      await click([...container.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === "Notes") ?? null);
      await remount(client);
      expect(useArchitectureView.getState()).toMatchObject({ trail: [{ id: "p:web", label: "web" }], selection: groupKey("dir:web/ui"), panel: "notes" });
      expect(node("dir:web/ui")).not.toBeNull();
      expect(container.querySelector('nav[aria-label="Architecture level"]')!.textContent).toContain("web");
    });

    it("keeps the drill-down into a component's files", async () => {
      const client = fakeClient({ loadState: vi.fn(async () => null), architecture: vi.fn(async (_r, request) => (request.focus ? levelView({ level: "components", focus: request.focus, leaf: true }) : packagesWithComponents())) });
      await mount(client);
      await act(async () => useArchitectureView.getState().open({ id: "p:web", label: "web" }));
      await settle();
      await remount(client);
      expect(client.groupGraph).toHaveBeenLastCalledWith(ROOT, { group: "p:web" });
      expect(node("p:web")).toBeNull();
    });

    it("keeps pan and zoom instead of fitting the view again", async () => {
      const client = clientForLevels();
      await mount(client);
      expect(flowState.lastProps!.fitView).toBe(true);
      expect(flowState.lastProps!.defaultViewport).toBeUndefined();
      await act(async () => flowState.lastProps!.onMoveEnd({}, { x: 40, y: -25, zoom: 0.8 }));
      await remount(client);
      expect(flowState.lastProps!.defaultViewport).toEqual({ x: 40, y: -25, zoom: 0.8 });
      expect(flowState.lastProps!.fitView).toBeUndefined();
    });

    it("starts afresh for a different repository", async () => {
      const client = clientForLevels();
      await mount(client);
      await doubleClick(node("p:web"));
      await act(async () => flowState.lastProps!.onMoveEnd({}, { x: 1, y: 2, zoom: 3 }));
      await remount(client, "/other");
      expect(useArchitectureView.getState()).toMatchObject({ root: "/other", trail: [], viewports: {} });
      expect(flowState.lastProps!.fitView).toBe(true);
    });
  });

  it("spaces nodes widely by default and lets the slider change it", async () => {
    await mount(clientWith());
    expect(useArchitectureView.getState().spacing).toBe(160);
    const slider = container.querySelector('input[aria-label="Distance between nodes"]') as HTMLInputElement;
    expect(slider.value).toBe("160");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(slider, "240");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    expect(useArchitectureView.getState().spacing).toBe(240);
  });

  describe("framework relations", () => {
    const withFrameworks = () => {
      const frameworks = {
        configured: true,
        applications: [{ framework: "express", package: "package.json:api", evidence: "declares dependency `express`" }],
        relations: 2,
        partial: false,
        diagnostics_total: 1,
        diagnostics: [{ path: "src/a.ts", message: "`app.get(base, …)` has a computed path; no relation emitted" }],
      };
      return fakeClient({
        loadState: vi.fn(async () => null),
        open: vi.fn(async () => openResponse({ snapshot: snapshot({ frameworks }) })),
        architecture: vi.fn(async (_r, request) =>
          levelView({ level: request.level, focus: request.focus ?? null, leaf: request.focus != null, framework_edges: [{ from: "p:web", to: "p:core", kinds: { route_registered_to: 2 } }] }),
        ),
        frameworkRelations: vi.fn(async () => ({
          snapshot: "snap-1",
          next_cursor: null,
          partial: false,
          relations: [{
            id: "rel:1", kind: "route_registered_to" as const, framework: "express", rule: { id: "express-route", version: 1 }, certainty: "declared" as const,
            from: "src/app.ts", to: "src/users.ts", from_symbol: null, to_symbol: "list", label: "GET /users",
            evidence: { file: "src/app.ts", span: { start: 0, end: 5 }, text: "app.get('/users', list)" }, package: "package.json:api",
          }],
        })),
      });
    };

    it("offers the layer only when the snapshot has relations, and draws them only when it is on", async () => {
      await mount(clientWith());
      expect(text()).not.toContain("Framework relations (");

      await mount(withFrameworks());
      expect(text()).toContain("Framework relations (2)");
      expect(edge("fw:p:web->p:core")).toBeNull();
      const checkbox = [...container.querySelectorAll('input[type="checkbox"]')].find((c) => c.parentElement?.textContent?.startsWith("Framework relations")) as HTMLInputElement;
      await click(checkbox);
      expect(edge("fw:p:web->p:core")).not.toBeNull();
      expect(edge("p:web->p:core")).not.toBeNull();
      expect(container.querySelector('[aria-label="Legend"]')!.textContent).toContain("framework relations");
    });

    it("says which frameworks were found and lists what could not be read, in the notices", async () => {
      await mount(withFrameworks());
      await click([...container.querySelectorAll("button")].find((b) => /^Notices \(/.test(b.textContent?.trim() ?? "")) ?? null);
      expect(text()).toContain("Frameworks detected");
      expect(text()).toContain("express: 2 relations");
      expect(text()).toContain("1 framework convention could not be read");
      expect(text()).toContain("has a computed path");
    });

    it("lists a file's relations in the inspector with the rule, certainty and source text", async () => {
      const client = withFrameworks();
      await mount(client);
      await act(async () => useArchitectureView.getState().open({ id: "p:web", label: "web" }));
      await settle();
      await click(container.querySelector('[data-testid="node:file:src/a.ts"]'));
      expect(client.frameworkRelations).toHaveBeenCalledWith(ROOT, { file: "src/a.ts", limit: 20 });
      expect(text()).toContain("GET /users");
      expect(text()).toContain("route · express");
      expect(text()).toContain("written in the code · express-route v1");
      expect(text()).toContain("app.get('/users', list)");
    });
  });
});
