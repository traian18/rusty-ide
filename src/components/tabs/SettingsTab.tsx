import React, { useState } from "react";
import { FileText, Palette, Settings2, Sparkles, type LucideIcon } from "lucide-react";
import { AppearanceSettings } from "../settings/AppearanceSettings";
import { TypographySettings } from "../settings/TypographySettings";
import { EditorFileSafetySettings } from "../settings/EditorFileSafetySettings";
import { WebSearchSettings } from "../settings/WebSearchSettings";
import { SmartReadSettings, SmartSearchSettings, SmartWebExtractSettings } from "../settings/SmartReadSettings";
import { StorageSettings } from "../settings/StorageSettings";
import { KeyboardShortcutsSettings } from "../settings/KeyboardShortcutsSettings";
import { UpdateSettings } from "../settings/UpdateSettings";
import styles from "./SettingsTab.module.css";

type SettingsCategoryId = "appearance" | "editor" | "intelligence" | "system";

type SettingsCategory = {
  id: SettingsCategoryId;
  label: string;
  description: string;
  icon: LucideIcon;
};

const settingsCategories: SettingsCategory[] = [
  {
    id: "appearance",
    label: "Appearance",
    description: "Customize Rusty's look and text presentation.",
    icon: Palette,
  },
  {
    id: "editor",
    label: "Editor",
    description: "Control file safety and keyboard interactions.",
    icon: FileText,
  },
  {
    id: "intelligence",
    label: "Intelligence",
    description: "Configure web and smart content tools.",
    icon: Sparkles,
  },
  {
    id: "system",
    label: "System",
    description: "Manage local storage and application updates.",
    icon: Settings2,
  },
];

function CategorySettings({ categoryId }: { categoryId: SettingsCategoryId }) {
  switch (categoryId) {
    case "appearance":
      return (
        <>
          <div className={styles.panel}><AppearanceSettings /></div>
          <div className={styles.panel}><TypographySettings /></div>
        </>
      );
    case "editor":
      return (
        <>
          <div className={styles.panel}><EditorFileSafetySettings /></div>
          <div className={styles.panel}><KeyboardShortcutsSettings /></div>
        </>
      );
    case "intelligence":
      return (
        <>
          <div className={styles.panel}><WebSearchSettings /></div>
          <div className={styles.panel}><SmartReadSettings /></div>
          <div className={styles.panel}><SmartSearchSettings /></div>
          <div className={styles.panel}><SmartWebExtractSettings /></div>
        </>
      );
    case "system":
      return (
        <>
          <div className={styles.panel}><StorageSettings /></div>
          <div className={styles.panel}><UpdateSettings /></div>
        </>
      );
  }
}

export const SettingsTab: React.FC = () => {
  const [activeCategoryId, setActiveCategoryId] = useState<SettingsCategoryId>("appearance");
  const activeCategory = settingsCategories.find(({ id }) => id === activeCategoryId) ?? settingsCategories[0];

  const selectAdjacentCategory = (direction: -1 | 1) => {
    const currentIndex = settingsCategories.findIndex(({ id }) => id === activeCategoryId);
    const nextIndex = (currentIndex + direction + settingsCategories.length) % settingsCategories.length;
    const nextCategory = settingsCategories[nextIndex];
    setActiveCategoryId(nextCategory.id);
    document.getElementById(`settings-tab-${nextCategory.id}`)?.focus();
  };

  return (
    <main className={styles.page} aria-labelledby="settings-page-title">
      <div className={styles.content}>
        <header className={styles.header}>
          <h1 className={styles.pageTitle} id="settings-page-title">Settings</h1>
          <p className={styles.pageDescription}>Personalize Rusty and configure how its tools work.</p>
        </header>

        <div className={styles.settingsLayout}>
          <nav className={styles.sidebar} aria-label="Settings categories">
            <div className={styles.tabList} role="tablist" aria-orientation="vertical">
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
            </div>
          </nav>

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
