// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PromptHistoryMenu, promptLabel } from "./PromptHistoryMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("PromptHistoryMenu", () => {
  it("lists the prompts oldest first, marks the highlighted one, and shows only each prompt's first line", () => {
    act(() => {
      root.render(<PromptHistoryMenu prompts={["first", "second\nwith more", "third"]} selectedIndex={2} onPick={() => {}} />);
    });
    const rows = [...container.querySelectorAll('[role="option"]')];
    expect(rows.map((row) => row.textContent)).toEqual(["first", "second", "third"]);
    expect(rows.map((row) => row.getAttribute("aria-selected"))).toEqual(["false", "false", "true"]);
    expect(rows[1].getAttribute("title")).toBe("second\nwith more");
    expect(container.querySelector('[role="listbox"]')?.getAttribute("aria-label")).toBe("Recent prompts");
  });

  it("picks the full prompt on click, without taking focus from the box", () => {
    const onPick = vi.fn();
    act(() => {
      root.render(<PromptHistoryMenu prompts={["a\nb"]} selectedIndex={0} onPick={onPick} />);
    });
    const row = container.querySelector('[role="option"]') as HTMLButtonElement;
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    row.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    act(() => row.click());
    expect(onPick).toHaveBeenCalledWith("a\nb");
  });

  it("moves the highlight with the mouse", () => {
    const onHover = vi.fn();
    act(() => {
      root.render(<PromptHistoryMenu prompts={["a", "b"]} selectedIndex={1} onPick={() => {}} onHover={onHover} />);
    });
    act(() => {
      container.querySelectorAll('[role="option"]')[0].dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(onHover).toHaveBeenCalledWith(0);
  });

  it("labels a prompt with its first line", () => {
    expect(promptLabel("  one\ntwo ")).toBe("one");
    expect(promptLabel("single")).toBe("single");
  });
});
