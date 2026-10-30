// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@xyflow/react", async () => (await import("./flowStub")).flowStub);

import { Bubble, OpenChildContext, type ArchitectureNodeData } from "./nodes";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const data = (overrides: Partial<ArchitectureNodeData> = {}): ArchitectureNodeData => ({
  id: "group:p", type: "group", label: "engine", subtitle: "", basis: "declared", badges: { high: 0, medium: 2, low: 0, info: 0 }, worst: "medium",
  hasNote: true, position: { x: 0, y: 0 }, tone: 0, inCycle: true, bubble: true, diameter: 90, width: 132, height: 128, fileCount: 40,
  major: false, detail: "rust 100%", selected: false, ...overrides,
});
const render = async (props: ArchitectureNodeData, zoom: number) => act(async () => root.render(<Bubble data={props} zoom={zoom} />));
const text = () => container.textContent ?? "";

describe("Bubble", () => {
  it("is only a circle when zoomed far out, unless it is one of the largest", async () => {
    await render(data(), 0.3);
    expect(text()).toBe("");
    await render(data({ major: true }), 0.3);
    expect(text()).toBe("engine");
  });

  it("keeps its name when selected even zoomed out, and always has an accessible name and a tooltip", async () => {
    await render(data({ selected: true }), 0.3);
    expect(text()).toBe("engine");
    await render(data(), 0.3);
    const box = container.firstElementChild!;
    expect(box.getAttribute("aria-label")).toContain("engine, 40 files, 2 findings, in an import cycle");
    expect(box.getAttribute("title")).toBe("engine · 40 files");
  });

  it("adds the file count and findings badge at a middle zoom", async () => {
    await render(data(), 0.9);
    expect(text()).toContain("engine");
    expect(text()).toContain("40");
    expect(container.querySelector('[class*="bubbleBadge"]')).not.toBeNull();
    expect(text()).not.toContain("rust 100%");
  });

  it("shows the language mix, cycle and note markers when zoomed in", async () => {
    await render(data(), 2);
    expect(text()).toContain("rust 100%");
    expect(container.querySelector('[aria-label="In an import cycle"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Has a note"]')).not.toBeNull();
  });

  it("sizes the circle by its diameter", async () => {
    await render(data({ diameter: 120 }), 1);
    const circle = container.querySelector('[class*="bubble"]:not([class*="bubbleBox"]):not([class*="bubbleLabel"])') as HTMLElement;
    expect([circle.style.width, circle.style.height]).toEqual(["120px", "120px"]);
  });

  it("shows its components as small circles that open on click, without opening the bubble", async () => {
    const opened: string[] = [];
    const children = [
      { id: "dir:a/one", label: "one", file_count: 8, has_children: true },
      { id: "dir:a/two", label: "two", file_count: 3, has_children: false },
    ];
    await act(async () =>
      root.render(
        <OpenChildContext.Provider value={(child) => opened.push(child.id)}>
          <Bubble data={data({ children, moreChildren: 2, diameter: 120 })} zoom={1} />
        </OpenChildContext.Provider>,
      ),
    );
    const dots = [...container.querySelectorAll("button")];
    expect(dots.map((dot) => dot.getAttribute("aria-label"))).toEqual(["Open one, 8 files", "Open two, 3 files"]);
    expect(text()).toContain("+2");
    await act(async () => dots[1].click());
    expect(opened).toEqual(["dir:a/two"]);
  });

  it("draws no circles inside a bubble without components", async () => {
    await render(data({ children: [] }), 1);
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});
