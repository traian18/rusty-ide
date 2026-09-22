import {
  formatShortcut,
  type ShortcutAction,
} from "../../preferences/shortcuts";
import { useWorkspaceStore } from "../../store";
import styles from "./KeyboardShortcutsSettings.module.css";

const shortcuts: Array<{ action: ShortcutAction; label: string; description: string; id: string }> = [
  {
    action: "closeActiveTab",
    label: "Close active tab",
    description: "Closes the selected editor tab.",
    id: "shortcut-close-active-tab",
  },
  {
    action: "openSearch",
    label: "Open search",
    description: "Opens the workspace search palette.",
    id: "shortcut-open-search",
  },
  {
    action: "toggleExplorer",
    label: "Toggle explorer",
    description: "Shows or collapses the file explorer.",
    id: "shortcut-toggle-explorer",
  },
];

export function KeyboardShortcutsSettings() {
  const preferences = useWorkspaceStore((state) => state.keyboardShortcuts);

  return (
    <section className={styles.section} aria-labelledby="keyboard-shortcuts-title">
      <div className={styles.heading}>
        <div>
          <h3 className={styles.title} id="keyboard-shortcuts-title">Keyboard shortcuts</h3>
          <p className={styles.description}>Preview of default keyboard shortcuts.</p>
        </div>
      </div>
      <div className={styles.list}>
        {shortcuts.map(({ action, label, description, id }) => (
          <div className={styles.row} key={action}>
            <div>
              <span className={styles.label}>{label}</span>
              <p className={styles.description}>{description}</p>
            </div>
            <div className={styles.actions}>
              <kbd id={id} className={styles.preview} tabIndex={-1}>
                {formatShortcut(preferences[action])}
              </kbd>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
