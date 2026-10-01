// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomSelect, type Option } from "./CustomSelect";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROW_HEIGHT = 20;
const LIST_HEIGHT = 160;
const LIST_TOP = 100;

const options: Option[] = Array.from({ length: 40 }, (_, index) => ({ id: `m${index}`, name: `Model ${index}` }));

let root: Root;
let container: HTMLDivElement;

/**
 * jsdom has no layout, so give the dropdown one: the options list is 160px
 * tall at y=100, each row 20px, and a row sits where its index and the list's
 * scroll position put it. The list's scrollTop is a real, settable number.
 */
function layOut() {
  const scrollTops = new WeakMap<Element, number>();
  vi.spyOn(HTMLElement.prototype, "scrollTop", "get").mockImplementation(function (this: HTMLElement) {
    return scrollTops.get(this) ?? 0;
  });
  vi.spyOn(HTMLElement.prototype, "scrollTop", "set").mockImplementation(function (this: HTMLElement, value: number) {
    scrollTops.set(this, Math.max(0, value)); // a browser never scrolls above the start
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.getAttribute("role") === "option") {
      const index = Number(this.textContent?.replace("Model ", ""));
      const list = this.parentElement as HTMLElement;
      const top = LIST_TOP + index * ROW_HEIGHT - (scrollTops.get(list) ?? 0);
      return { top, bottom: top + ROW_HEIGHT, height: ROW_HEIGHT, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    }
    if (this.querySelector('[role="option"]') && !this.getAttribute("role")) {
      return { top: LIST_TOP, bottom: LIST_TOP + LIST_HEIGHT, height: LIST_HEIGHT, left: 0, right: 100, width: 100, x: 0, y: LIST_TOP, toJSON: () => ({}) } as DOMRect;
    }
    return { top: 0, bottom: 30, height: 30, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
  return scrollTops;
}

const render = (value: string, extra: { options?: Option[] } = {}) =>
  act(() => {
    root.render(<CustomSelect id="model" value={value} onChange={() => {}} options={extra.options ?? options} />);
  });

const open = () =>
  act(() => {
    (container.querySelector("#model") as HTMLButtonElement).click();
  });

const list = () => document.querySelector('[role="listbox"] [role="option"]')?.parentElement as HTMLElement;
const selectedRow = () => document.querySelector('[role="option"][aria-selected="true"]') as HTMLElement;

describe("CustomSelect", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("opens with the selected option in the middle of the list, not at the top", () => {
    const scrollTops = layOut();
    render("m25");
    open();

    // Row 25 is at 500px of the list; centred in a 160px window it needs 500 - 70 = 430 scrolled.
    expect(scrollTops.get(list())).toBe(25 * ROW_HEIGHT - (LIST_HEIGHT - ROW_HEIGHT) / 2);
    const row = selectedRow().getBoundingClientRect();
    const middle = LIST_TOP + LIST_HEIGHT / 2;
    expect(Math.abs((row.top + row.bottom) / 2 - middle)).toBeLessThanOrEqual(ROW_HEIGHT / 2);
  });

  it("stays at the top for the first option, since a list cannot scroll above its start", () => {
    const scrollTops = layOut();
    render("m0");
    open();
    expect(scrollTops.get(list())).toBe(0);
    expect(selectedRow().textContent).toBe("Model 0");
  });

  it("does not scroll when nothing is selected", () => {
    const scrollTops = layOut();
    render("missing");
    open();
    expect(scrollTops.get(list())).toBeUndefined();
  });

  it("scrolls once per opening, so the user can scroll the list without being pulled back", () => {
    const scrollTops = layOut();
    render("m25");
    open();
    const centred = scrollTops.get(list()) as number;

    // The user scrolls the list; the dropdown re-measures its position on every scroll.
    act(() => {
      scrollTops.set(list(), 40);
      list().dispatchEvent(new Event("scroll", { bubbles: true }));
      window.dispatchEvent(new Event("resize"));
    });
    expect(scrollTops.get(list())).toBe(40);
    expect(centred).not.toBe(40);
  });

  it("centres again each time it is reopened", () => {
    const scrollTops = layOut();
    render("m25");
    open();
    const first = scrollTops.get(list()) as number;
    open(); // closes
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    open();
    expect(scrollTops.get(list())).toBe(first);
  });

  it("opens a short list without needing layout at all", () => {
    render("m1", { options: options.slice(0, 3) });
    open();
    expect(selectedRow().textContent).toBe("Model 1");
  });
});
