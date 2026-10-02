// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatInput } from "./ChatInput";

vi.mock("../../store", () => ({
  useWorkspaceStore: (selector: (state: { fileTree: unknown[]; rootPath: string }) => unknown) => selector({ fileTree: [], rootPath: "/ws" }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../../services/searchService", () => ({ searchService: { searchProject: vi.fn() } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Newest first, as the chat tab provides them.
const HISTORY = ["ship it", "add tests", "fix the build"];

let root: Root;
let container: HTMLDivElement;
let onSend: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;

function Harness({ history = HISTORY, initial = "", disabled = false }: { history?: readonly string[]; initial?: string; disabled?: boolean }) {
  const [value, setValue] = useState(initial);
  return <ChatInput value={value} onChange={setValue} onSend={onSend} promptHistory={history} disabled={disabled} />;
}

const mount = (props: Parameters<typeof Harness>[0] = {}) =>
  act(() => {
    root.render(<Harness {...props} />);
  });

const box = () => container.querySelector("textarea") as HTMLTextAreaElement;
const menu = () => container.querySelector('[aria-label="Recent prompts"]');
const rows = () => [...container.querySelectorAll('[role="option"]')];
const labels = () => rows().map((row) => row.textContent);
const selected = () => rows().findIndex((row) => row.getAttribute("aria-selected") === "true");

function press(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    box().dispatchEvent(event);
  });
  return event;
}

function type(text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(box(), text);
    box().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  onSend = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("ChatInput: the up arrow shows recent prompts", () => {
  it("opens a list of them in an empty box, oldest at the top and the newest next to the box, highlighted", () => {
    mount();
    const event = press("ArrowUp");
    expect(event.defaultPrevented).toBe(true);
    expect(labels()).toEqual(["fix the build", "add tests", "ship it"]);
    expect(selected()).toBe(2);
  });

  it("walks back with up and uses the highlighted prompt on Enter, instead of sending", () => {
    mount();
    press("ArrowUp");
    press("ArrowUp");
    expect(selected()).toBe(1);
    press("Enter");
    expect(menu()).toBeNull();
    expect(box().value).toBe("add tests");
    expect(onSend).not.toHaveBeenCalled();
    act(() => {
      vi.runAllTimers();
    });
    expect(box().selectionStart).toBe("add tests".length);
  });

  it("uses a prompt on click", () => {
    mount();
    press("ArrowUp");
    act(() => (rows()[0] as HTMLButtonElement).click());
    expect(box().value).toBe("fix the build");
    expect(menu()).toBeNull();
  });

  it("goes back to the box with down from the newest, and with Escape, leaving a draft untouched", () => {
    mount({ initial: "my draft" });
    box().setSelectionRange(0, 0);
    press("ArrowUp");
    expect(menu()).not.toBeNull();
    press("Escape");
    expect(menu()).toBeNull();
    expect(box().value).toBe("my draft");

    box().setSelectionRange(0, 0);
    press("ArrowUp");
    press("ArrowDown");
    expect(menu()).toBeNull();
    expect(box().value).toBe("my draft");
  });

  it("leaves up alone inside a draft, so the caret still moves", () => {
    mount({ initial: "first line\nsecond line" });
    box().setSelectionRange(14, 14);
    const event = press("ArrowUp");
    expect(menu()).toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });

  it("closes when the person carries on typing", () => {
    mount();
    press("ArrowUp");
    type("n");
    expect(menu()).toBeNull();
    expect(box().value).toBe("n");
  });

  it("offers nothing when there is no history, or while the agent is busy", () => {
    mount({ history: [] });
    press("ArrowUp");
    expect(menu()).toBeNull();

    mount({ disabled: true });
    press("ArrowUp");
    expect(menu()).toBeNull();
  });

  it("still sends on Enter when the menu is not open", () => {
    mount({ initial: "go" });
    press("Enter");
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("closes when the box loses focus", () => {
    mount();
    press("ArrowUp");
    act(() => {
      box().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(menu()).toBeNull();
  });
});
