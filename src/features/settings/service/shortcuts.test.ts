import { describe, expect, it } from "vitest";
import {
  normalizeKeyboardShortcuts,
  SHORTCUT_ACTIONS,
  SHORTCUT_DEFAULTS,
  shortcutConflicts,
  shortcutFromKeyboardEvent,
} from "./shortcuts";

describe("keyboard shortcuts", () => {
  it("has Back and Forward on Cmd/Ctrl+Option/Alt+Left/Right, as in IntelliJ", () => {
    expect(SHORTCUT_DEFAULTS.navigateBack).toBe("Mod+Alt+ArrowLeft");
    expect(SHORTCUT_DEFAULTS.navigateForward).toBe("Mod+Alt+ArrowRight");
    const event = { key: "ArrowLeft", metaKey: true, ctrlKey: false, altKey: true, shiftKey: false } as KeyboardEvent;
    expect(shortcutFromKeyboardEvent(event)).toBe("Mod+Alt+ArrowLeft");
  });

  it("fills actions missing from what was stored with their defaults", () => {
    const loaded = normalizeKeyboardShortcuts({ version: 1, shortcuts: { openSearch: "Mod+P" } });
    expect(loaded.openSearch).toBe("Mod+P");
    expect(loaded.navigateBack).toBe("Mod+Alt+ArrowLeft");
    expect(Object.keys(loaded).sort()).toEqual(SHORTCUT_ACTIONS.map((entry) => entry.action).sort());
  });

  it("names the action a shortcut clashes with", () => {
    expect(shortcutConflicts(SHORTCUT_DEFAULTS)).toEqual({});
    expect(shortcutConflicts({ ...SHORTCUT_DEFAULTS, navigateForward: "Mod+K" })).toEqual({ navigateForward: "openSearch" });
  });
});
