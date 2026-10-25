import { useEffect, useState, type KeyboardEvent } from "react";
import {
  formatShortcut,
  isValidShortcut,
  SHORTCUT_ACTIONS,
  SHORTCUT_DEFAULTS,
  shortcutConflicts,
  shortcutFromKeyboardEvent,
  type KeyboardShortcutPreferences,
  type ShortcutAction,
} from "../../preferences/shortcuts";
import { useWorkspaceStore } from "../../store";
import { Button } from "../ui/Button/Button";
import styles from "./KeyboardShortcutsSettings.module.css";

const labelOf = (action: ShortcutAction) => SHORTCUT_ACTIONS.find((entry) => entry.action === action)?.label ?? action;
const idOf = (action: ShortcutAction) => `shortcut-${action.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
const sameShortcuts = (a: KeyboardShortcutPreferences, b: KeyboardShortcutPreferences) =>
  SHORTCUT_ACTIONS.every(({ action }) => a[action] === b[action]);

/** The shortcuts, editable: Change records a new key combination, and
 * nothing applies until Save. Two actions cannot share a shortcut. */
export function KeyboardShortcutsSettings() {
  const saved = useWorkspaceStore((state) => state.keyboardShortcuts);
  const setKeyboardShortcuts = useWorkspaceStore((state) => state.setKeyboardShortcuts);
  const [draft, setDraft] = useState<KeyboardShortcutPreferences>(saved);
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const dirty = !sameShortcuts(draft, saved);
  const conflicts = shortcutConflicts(draft);
  const hasConflicts = Object.keys(conflicts).length > 0;

  // Shortcuts saved elsewhere show up here while nothing is being edited.
  useEffect(() => {
    if (!dirty) setDraft(saved);
  }, [saved]);

  const update = (action: ShortcutAction, shortcut: string) => {
    setDraft((current) => ({ ...current, [action]: shortcut }));
    setStatus(null);
  };

  const record = (action: ShortcutAction, event: KeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setRecording(null);
      setHint(null);
      return;
    }
    const shortcut = shortcutFromKeyboardEvent(event);
    if (!shortcut) return;
    if (!isValidShortcut(shortcut)) {
      setHint("Use at least one modifier key: ⌘ or Ctrl, ⌥ Option or Alt, ⇧ Shift.");
      return;
    }
    update(action, shortcut);
    setRecording(null);
    setHint(null);
  };

  const save = () => {
    if (!dirty || hasConflicts) return;
    setKeyboardShortcuts(draft);
    setStatus("Saved.");
  };

  return (
    <section className={styles.section} aria-labelledby="keyboard-shortcuts-title">
      <div className={styles.heading}>
        <div>
          <h3 className={styles.title} id="keyboard-shortcuts-title">Keyboard shortcuts</h3>
          <p className={styles.description}>Choose Change and press the new key combination. Changes apply when you save.</p>
        </div>
      </div>
      <div className={styles.list}>
        {SHORTCUT_ACTIONS.map(({ action, label, description, defaultShortcut }) => {
          const clash = conflicts[action];
          return (
            <div className={styles.row} key={action}>
              <div>
                <span className={styles.label}>{label}</span>
                <p className={styles.description}>{description}</p>
                {clash && <p className={styles.conflict} role="alert">Also used by {labelOf(clash)}. Choose another shortcut.</p>}
                {recording === action && hint && <p className={styles.conflict}>{hint}</p>}
              </div>
              <div className={styles.actions}>
                <kbd id={idOf(action)} className={styles.preview} tabIndex={-1}>
                  {formatShortcut(draft[action])}
                </kbd>
                {recording === action ? (
                  <button
                    type="button"
                    className={styles.recorder}
                    data-shortcut-recorder
                    autoFocus
                    aria-label={`Press the new shortcut for ${label}, or Escape to cancel`}
                    onKeyDown={(event) => record(action, event)}
                    onBlur={() => { setRecording(null); setHint(null); }}
                  >
                    Press keys… (Esc cancels)
                  </button>
                ) : (
                  <Button variant="secondary" aria-label={`Change the shortcut for ${label}`} onClick={() => { setRecording(action); setHint(null); }}>
                    Change
                  </Button>
                )}
                <Button
                  variant="ghost"
                  aria-label={`Use the default shortcut for ${label}`}
                  disabled={draft[action] === defaultShortcut}
                  onClick={() => update(action, defaultShortcut)}
                >
                  Default
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      <div className={styles.footer}>
        <span className={styles.status} role="status">{status ?? (dirty ? "Unsaved changes." : "")}</span>
        <Button variant="ghost" disabled={sameShortcuts(draft, SHORTCUT_DEFAULTS)} onClick={() => { setDraft({ ...SHORTCUT_DEFAULTS }); setStatus(null); }}>
          Restore all defaults
        </Button>
        <Button variant="ghost" disabled={!dirty} onClick={() => { setDraft(saved); setStatus(null); }}>
          Discard changes
        </Button>
        <Button variant="primary" disabled={!dirty || hasConflicts} onClick={save}>
          Save
        </Button>
      </div>
    </section>
  );
}
