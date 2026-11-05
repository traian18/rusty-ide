// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPLIT_WIDTH_KEY, useSplitWidth } from "./useSplitWidth";

const OUTLET_WIDTH = 1000;

function Outlet() {
  const outletRef = useRef<HTMLDivElement>(null);
  const { leftPercent, handle } = useSplitWidth(outletRef);
  return <div ref={outletRef} data-width={leftPercent}>{handle}</div>;
}

describe("useSplitWidth", () => {
  let host: HTMLDivElement;
  let root: Root;

  const outlet = () => host.querySelector<HTMLElement>("[data-width]")!;
  const handle = () => host.querySelector<HTMLElement>('[role="separator"]')!;
  const width = () => Number(outlet().dataset.width);
  const press = (key: string) => act(() => {
    handle().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
  const pointer = (type: string, x: number) => handle().dispatchEvent(
    Object.assign(new Event(type, { bubbles: true }), { clientX: x, pointerId: 1, button: 0 }),
  );

  function renderOutlet() {
    act(() => root.render(<Outlet />));
    outlet().getBoundingClientRect = () => ({ left: 100, width: OUTLET_WIDTH }) as DOMRect;
    handle().setPointerCapture = vi.fn();
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    localStorage.removeItem(SPLIT_WIDTH_KEY);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    localStorage.removeItem(SPLIT_WIDTH_KEY);
  });

  it("starts even", () => {
    renderOutlet();
    expect(width()).toBe(50);
  });

  it("follows the pointer, relative to the outlet, and remembers it", () => {
    renderOutlet();
    act(() => {
      pointer("pointerdown", 600);
      pointer("pointermove", 400);
      pointer("pointerup", 400);
    });
    expect(width()).toBe(30);
    expect(localStorage.getItem(SPLIT_WIDTH_KEY)).toBe("30");
  });

  it("ignores pointer moves outside a drag", () => {
    renderOutlet();
    act(() => pointer("pointermove", 400));
    expect(width()).toBe(50);
  });

  it("keeps both sides usable", () => {
    renderOutlet();
    act(() => {
      pointer("pointerdown", 600);
      pointer("pointermove", 100);
    });
    expect(width()).toBe(20);
    act(() => pointer("pointermove", 1100));
    expect(width()).toBe(80);
  });

  it("resizes by keyboard", () => {
    renderOutlet();
    press("ArrowRight");
    expect(width()).toBe(52);
    press("ArrowLeft");
    press("ArrowLeft");
    expect(width()).toBe(48);
    press("Home");
    expect(width()).toBe(20);
    press("End");
    expect(width()).toBe(80);
  });

  it("goes back to even on a double click", () => {
    renderOutlet();
    press("Home");
    act(() => {
      handle().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(width()).toBe(50);
  });

  it.each([["35", 35], ["5", 20], ["95", 80], ["garbage", 50]])("restores a saved width of %s as %s", (saved, expected) => {
    localStorage.setItem(SPLIT_WIDTH_KEY, saved);
    renderOutlet();
    expect(width()).toBe(expected);
  });
});
