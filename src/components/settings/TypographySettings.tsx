import { RotateCcw } from "lucide-react";
import { TYPOGRAPHY_LIMITS, type TypographyPreferenceKey } from "../../preferences/typography";
import { useWorkspaceStore } from "../../store";
import { Button, NumberStepper } from "../ui";
import styles from "./TypographySettings.module.css";

const controls: Array<{
  key: TypographyPreferenceKey;
  label: string;
  description: string;
  id: string;
  decrementId: string;
  incrementId: string;
}> = [
  {
    key: "editorFontSize",
    label: "Editor text",
    description: "Code editors and diff editors.",
    id: "typography-editor-size",
    decrementId: "typography-editor-decrement",
    incrementId: "typography-editor-increment",
  },
  {
    key: "chatFontSize",
    label: "Chat text",
    description: "Messages, Markdown, activity, and composer.",
    id: "typography-chat-size",
    decrementId: "typography-chat-decrement",
    incrementId: "typography-chat-increment",
  },
  {
    key: "ideFontSize",
    label: "Interface text",
    description: "Sidebar, tabs, toolbars, panels, and dialogs.",
    id: "typography-ide-size",
    decrementId: "typography-ide-decrement",
    incrementId: "typography-ide-increment",
  },
];

export function TypographySettings() {
  const preferences = useWorkspaceStore((state) => state.typographyPreferences);
  const setPreference = useWorkspaceStore((state) => state.setTypographyPreference);
  const reset = useWorkspaceStore((state) => state.resetTypographyPreferences);

  return (
    <section className={styles.section} aria-labelledby="typography-settings-title">
      <div className={styles.heading}>
        <div>
          <h3 className={styles.title} id="typography-settings-title">Text sizes</h3>
          <p className={styles.description}>Each area scales independently and updates immediately.</p>
        </div>
        <Button id="typography-reset-all" variant="ghost" icon={<RotateCcw size={13} />} onClick={reset}>
          Reset all
        </Button>
      </div>
      <div className={styles.grid}>
        {controls.map((control) => {
          const limits = TYPOGRAPHY_LIMITS[control.key];
          return (
            <div className={styles.card} key={control.key}>
              <div>
                <label className={styles.label} htmlFor={control.id}>{control.label}</label>
                <p className={styles.hint}>{control.description}</p>
              </div>
              <NumberStepper
                id={control.id}
                decrementId={control.decrementId}
                incrementId={control.incrementId}
                label={control.label}
                value={preferences[control.key]}
                min={limits.min}
                max={limits.max}
                step={limits.step}
                onChange={(value) => setPreference(control.key, value)}
              />
            </div>
          );
        })}
      </div>
      <div className={styles.preview} aria-live="polite">
        <span className={styles.idePreview}>Interface preview</span>
        <span className={styles.chatPreview}>Chat preview: clear, comfortable reading.</span>
        <code>const editorPreview = true;</code>
      </div>
    </section>
  );
}
