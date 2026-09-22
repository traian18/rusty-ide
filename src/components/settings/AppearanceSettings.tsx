import { themeOptions } from "../../theme";
import { useWorkspaceStore } from "../../store";
import { CustomSelect } from "../CustomSelect";
import { Field } from "../ui";
import styles from "./AppearanceSettings.module.css";

export function AppearanceSettings() {
  const activeThemeId = useWorkspaceStore((state) => state.activeThemeId);
  const setActiveThemeId = useWorkspaceStore((state) => state.setActiveThemeId);

  return (
    <section className={styles.section} aria-labelledby="appearance-settings-title">
      <div>
        <h3 className={styles.title} id="appearance-settings-title">Appearance</h3>
        <p className={styles.description}>Choose the color theme used throughout Rusty.</p>
      </div>
      <Field id="appearance-theme-select" label="Theme">
        <CustomSelect
          id="appearance-theme-select"
          value={activeThemeId}
          onChange={setActiveThemeId}
          options={themeOptions.map((themeOption) => ({
            id: themeOption.id,
            name: themeOption.name,
          }))}
        />
      </Field>
    </section>
  );
}
