export type ShortcutAction = "closeActiveTab" | "openSearch" | "toggleExplorer";

export type KeyboardShortcutPreferences = Record<ShortcutAction, string>;

export const SHORTCUT_STORAGE_KEY = "rusty_keyboard_shortcuts";
export const SHORTCUT_STORAGE_VERSION = 1;

export const SHORTCUT_DEFAULTS: KeyboardShortcutPreferences = {
  closeActiveTab: "Mod+W",
  openSearch: "Mod+K",
  toggleExplorer: "Mod+1",
};

const MODIFIER_ORDER = ["Mod", "Ctrl", "Alt", "Shift"] as const;

function normalizeKey(key: string): string {
  if (key === " ") return "Space";
  if (key.length === 1) return key.toUpperCase();
  return key === "Esc" ? "Escape" : key;
}

export function shortcutFromKeyboardEvent(event: KeyboardEvent | React.KeyboardEvent): string | null {
  const key = normalizeKey(event.key);
  if (["Meta", "Control", "Alt", "Shift"].includes(key)) return null;

  const parts: string[] = [];
  if (event.metaKey) parts.push("Mod");
  else if (event.ctrlKey) parts.push("Mod");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

export function isValidShortcut(shortcut: unknown): shortcut is string {
  if (typeof shortcut !== "string") return false;
  const parts = shortcut.split("+");
  const key = parts[parts.length - 1];
  return Boolean(key && key.length > 0 && parts.some((part) => MODIFIER_ORDER.includes(part as typeof MODIFIER_ORDER[number])));
}

export function normalizeKeyboardShortcuts(value: unknown): KeyboardShortcutPreferences {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const stored = record.shortcuts && typeof record.shortcuts === "object"
    ? record.shortcuts as Record<string, unknown>
    : record;

  return {
    closeActiveTab: isValidShortcut(stored.closeActiveTab) ? stored.closeActiveTab : SHORTCUT_DEFAULTS.closeActiveTab,
    openSearch: isValidShortcut(stored.openSearch) ? stored.openSearch : SHORTCUT_DEFAULTS.openSearch,
    toggleExplorer: isValidShortcut(stored.toggleExplorer) ? stored.toggleExplorer : SHORTCUT_DEFAULTS.toggleExplorer,
  };
}

export function loadKeyboardShortcuts(): KeyboardShortcutPreferences {
  if (typeof localStorage === "undefined") return { ...SHORTCUT_DEFAULTS };
  try {
    const raw = localStorage.getItem(SHORTCUT_STORAGE_KEY);
    return raw ? normalizeKeyboardShortcuts(JSON.parse(raw)) : { ...SHORTCUT_DEFAULTS };
  } catch {
    return { ...SHORTCUT_DEFAULTS };
  }
}

export function saveKeyboardShortcuts(shortcuts: KeyboardShortcutPreferences): KeyboardShortcutPreferences {
  const normalized = normalizeKeyboardShortcuts(shortcuts);
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(
      SHORTCUT_STORAGE_KEY,
      JSON.stringify({ version: SHORTCUT_STORAGE_VERSION, shortcuts: normalized }),
    );
  }
  return normalized;
}

export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  return shortcutFromKeyboardEvent(event) === shortcut;
}

export function formatShortcut(shortcut: string): string {
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  if (!isMac) return shortcut.replace("Mod", "Ctrl");
  return shortcut
    .replace("Mod", "⌘")
    .replace("Alt", "⌥")
    .replace("Shift", "⇧")
    .split("+").join("");
}
