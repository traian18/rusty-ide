/** Every action a keyboard shortcut can trigger, with what Settings shows for it. */
export const SHORTCUT_ACTIONS = [
  { action: "closeActiveTab", label: "Close active tab", description: "Closes the selected editor tab.", defaultShortcut: "Mod+W" },
  { action: "openSearch", label: "Open search", description: "Opens the workspace search palette.", defaultShortcut: "Mod+K" },
  { action: "toggleExplorer", label: "Toggle explorer", description: "Shows or collapses the file explorer.", defaultShortcut: "Mod+1" },
  { action: "navigateBack", label: "Navigate back", description: "Goes back to where the cursor was before, also in another file.", defaultShortcut: "Mod+Alt+ArrowLeft" },
  { action: "navigateForward", label: "Navigate forward", description: "Goes forward again after navigating back.", defaultShortcut: "Mod+Alt+ArrowRight" },
] as const;

export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number]["action"];

export type KeyboardShortcutPreferences = Record<ShortcutAction, string>;

export const SHORTCUT_STORAGE_KEY = "rusty_keyboard_shortcuts";
export const SHORTCUT_STORAGE_VERSION = 1;

export const SHORTCUT_DEFAULTS: KeyboardShortcutPreferences = Object.fromEntries(
  SHORTCUT_ACTIONS.map(({ action, defaultShortcut }) => [action, defaultShortcut]),
) as KeyboardShortcutPreferences;

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

  return Object.fromEntries(
    SHORTCUT_ACTIONS.map(({ action, defaultShortcut }) => {
      const value = stored[action];
      return [action, isValidShortcut(value) ? value : defaultShortcut];
    }),
  ) as KeyboardShortcutPreferences;
}

/** Actions whose shortcut an earlier action already uses, with that action. */
export function shortcutConflicts(shortcuts: KeyboardShortcutPreferences): Partial<Record<ShortcutAction, ShortcutAction>> {
  const owner = new Map<string, ShortcutAction>();
  const conflicts: Partial<Record<ShortcutAction, ShortcutAction>> = {};
  for (const { action } of SHORTCUT_ACTIONS) {
    const taken = owner.get(shortcuts[action]);
    if (taken) conflicts[action] = taken;
    else owner.set(shortcuts[action], action);
  }
  return conflicts;
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

const KEY_SYMBOLS: Record<string, string> = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓" };
const MAC_MODIFIERS: Record<string, string> = { Mod: "⌘", Alt: "⌥", Shift: "⇧" };

export function formatShortcut(shortcut: string): string {
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const parts = shortcut.split("+").map((part) => KEY_SYMBOLS[part] ?? part);
  if (!isMac) return parts.map((part) => (part === "Mod" ? "Ctrl" : part)).join("+");
  return parts.map((part) => MAC_MODIFIERS[part] ?? part).join("");
}
