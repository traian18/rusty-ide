import React, { useState } from "react";
import { FileText, MonitorCog, Palette, Sparkles, type LucideIcon } from "lucide-react";
import { AppearanceSettings } from "../settings/AppearanceSettings";
import { TypographySettings } from "../settings/TypographySettings";
import { EditorFileSafetySettings } from "../settings/EditorFileSafetySettings";
import { WebSearchSettings } from "../settings/WebSearchSettings";
import { SmartReadSettings, SmartSearchSettings, SmartWebExtractSettings } from "../settings/SmartReadSettings";
import { IntelligentModelSelectionSettings } from "../settings/IntelligentModelSelectionSettings";
import { KeyboardShortcutsSettings } from "../settings/KeyboardShortcutsSettings";
import { UpdateSettings } from "../settings/UpdateSettings";
import { StorageSettings } from "../settings/StorageSettings";
import styles from "./SettingsTab.module.css";

type SettingsCategoryId = "appearance" | "editor" | "intelligence" | "system";

interface SettingsCategory {
  id: SettingsCategoryId;
  label: string;
  description: string;
  icon: LucideIcon;
}

const settingsCategories: SettingsCategory[] = [
  { id: "appearance", label: "Appearance", description: "Personalize the application theme and typography.", icon: Palette },
  { id: "editor", label: "Editor", description: "Configure editor file safety behavior.", icon: FileText },
  { id: "intelligence", label: "Intelligence", description: "Configure model selection, web search, and smart content tools.", icon: Sparkles },
  { id: "system", label: "System", description: "Check the installed version, install updates, and manage local cache.", icon: MonitorCog },
];

const CategorySettings: React.FC<{ categoryId: SettingsCategoryId }> = ({ categoryId }) => {
  switch (categoryId) {
    case "appearance":
      return <><div className={styles.panel}><AppearanceSettings /></div><div className={styles.panel}><TypographySettings /></div></>;
    case "editor":
      return <>
        <div className={styles.panel}><EditorFileSafetySettings /></div>
        <div className={styles.panel}><KeyboardShortcutsSettings /></div>
      </>;
    case "intelligence":
      return <>
        <div className={styles.panel}><IntelligentModelSelectionSettings /></div>
        <div className={styles.panel}><WebSearchSettings /></div>
        <div className={styles.panel}><SmartReadSettings /></div>
        <div className={styles.panel}><SmartSearchSettings /></div>
        <div className={styles.panel}><SmartWebExtractSettings /></div>
      </>;
    case "system":
      return <>
        <div className={styles.panel}><UpdateSettings /></div>
        <div className={styles.panel}><StorageSettings /></div>
      </>;
  }
};

export const SettingsTab: React.FC = () => {
  const [activeCategoryId, setActiveCategoryId] = useState<SettingsCategoryId>("appearance");
  const activeCategory = settingsCategories.find((category) => category.id === activeCategoryId) || settingsCategories[0];
  const selectAdjacentCategory = (direction: number) => {
    const currentIndex = settingsCategories.findIndex((category) => category.id === activeCategoryId);
    setActiveCategoryId(settingsCategories[(currentIndex + direction + settingsCategories.length) % settingsCategories.length].id);
  };
  return (
    <main className={styles.page}>
      <div className={styles.content}>
        <header className={styles.header}>
          <h1 className={styles.pageTitle}>Settings</h1>
          <p className={styles.pageDescription}>Customize how Rusty looks and behaves.</p>
        </header>
        <div className={styles.settingsLayout}>
          <aside className={styles.sidebar}>
            <nav className={styles.tabList} role="tablist" aria-label="Settings categories" aria-orientation="vertical">
              {settingsCategories.map((category) => {
                const Icon = category.icon;
                const isActive = category.id === activeCategoryId;
                return (
                  <button
                    className={`${styles.tab} ${isActive ? styles.activeTab : ""}`}
                    id={`settings-tab-${category.id}`}
                    key={category.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    aria-controls={`settings-panel-${category.id}`}
                    tabIndex={isActive ? 0 : -1}
                    onClick={() => setActiveCategoryId(category.id)}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
                        event.preventDefault();
                        selectAdjacentCategory(1);
                      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
                        event.preventDefault();
                        selectAdjacentCategory(-1);
                      }
                    }}
                  >
                    <Icon aria-hidden="true" size={16} strokeWidth={1.8} />
                    <span>{category.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
          <section
            className={styles.category}
            id={`settings-panel-${activeCategory.id}`}
            role="tabpanel"
            aria-labelledby={`settings-tab-${activeCategory.id}`}
          >
            <header className={styles.categoryHeader}>
              <h2 className={styles.categoryTitle}>{activeCategory.label}</h2>
              <p className={styles.categoryDescription}>{activeCategory.description}</p>
            </header>
            <div className={styles.panels}>
              <CategorySettings categoryId={activeCategory.id} />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
};
