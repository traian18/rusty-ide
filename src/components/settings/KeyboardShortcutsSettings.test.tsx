// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SHORTCUT_DEFAULTS, SHORTCUT_STORAGE_KEY } from "../../preferences/shortcuts";
import { useWorkspaceStore } from "../../store";
import { KeyboardShortcutsSettings } from "./KeyboardShortcutsSettings";

let container: HTMLDivElement;
let root: Root;

const button = (label: string) => {
  const found = [...container.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === label || b.textContent?.trim() === label);
  if (!found) throw new Error(`no button ${label}`);
  return found;
};
const click = (label: string) => act(async () => button(label).click());
const press = (init: KeyboardEventInit) =>
  act(async () => {
    container.querySelector("[data-shortcut-recorder]")!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
  });

describe("keyboard shortcut settings", () => {
  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    localStorage.clear();
    useWorkspaceStore.setState({ keyboardShortcuts: { ...SHORTCUT_DEFAULTS } });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<KeyboardShortcutsSettings />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("lists Navigate back and forward with their shortcuts", () => {
    expect(container.textContent).toContain("Navigate back");
    expect(container.textContent).toContain("Navigate forward");
    expect(container.querySelector("#shortcut-navigate-back")?.textContent).toBe("Ctrl+Alt+←");
    expect(container.querySelector("#shortcut-close-active-tab")?.textContent).toBe("Ctrl+W");
  });

  it("records a new shortcut and applies it only on Save", async () => {
    await click("Change the shortcut for Navigate back");
    await press({ key: "b", ctrlKey: true, shiftKey: true });
    expect(container.querySelector("#shortcut-navigate-back")?.textContent).toBe("Ctrl+Shift+B");
    expect(useWorkspaceStore.getState().keyboardShortcuts.navigateBack).toBe("Mod+Alt+ArrowLeft");
    expect(container.textContent).toContain("Unsaved changes.");

    await click("Save");
    expect(useWorkspaceStore.getState().keyboardShortcuts.navigateBack).toBe("Mod+Shift+B");
    expect(JSON.parse(localStorage.getItem(SHORTCUT_STORAGE_KEY)!).shortcuts.navigateBack).toBe("Mod+Shift+B");
    expect(container.textContent).toContain("Saved.");
    expect(button("Save").disabled).toBe(true);
  });

  it("blocks Save while two actions share a shortcut", async () => {
    await click("Change the shortcut for Navigate forward");
    await press({ key: "k", ctrlKey: true });
    expect(container.textContent).toContain("Also used by Open search");
    expect(button("Save").disabled).toBe(true);
    await click("Use the default shortcut for Navigate forward");
    expect(button("Save").disabled).toBe(true);
    expect(container.textContent).not.toContain("Also used by");
  });

  it("needs a modifier, cancels on Escape, and can discard or restore the defaults", async () => {
    await click("Change the shortcut for Open search");
    await press({ key: "p" });
    expect(container.textContent).toContain("Use at least one modifier key");
    await press({ key: "Escape" });
    expect(container.querySelector("[data-shortcut-recorder]")).toBeNull();

    await click("Change the shortcut for Open search");
    await press({ key: "p", ctrlKey: true });
    await click("Discard changes");
    expect(container.querySelector("#shortcut-open-search")?.textContent).toBe("Ctrl+K");

    useWorkspaceStore.getState().setKeyboardShortcuts({ ...SHORTCUT_DEFAULTS, openSearch: "Mod+P" });
    await act(async () => {});
    await click("Restore all defaults");
    await click("Save");
    expect(useWorkspaceStore.getState().keyboardShortcuts.openSearch).toBe("Mod+K");
  });
});
