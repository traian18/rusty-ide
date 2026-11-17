import type { ReactNode } from "react";
import styles from "./PageShell.module.css";

export interface PageShellProps {
  title: ReactNode;
  /** Shown before the title, in the accent color (18px suits it). */
  icon?: ReactNode;
  description?: ReactNode;
  /** Under the description, still part of the header (a status line, a warning). */
  headerExtra?: ReactNode;
  children: ReactNode;
}

/** A full-page tab's frame, the same as Settings': centered column, small title, plain description. */
export function PageShell({ title, icon, description, headerExtra, children }: PageShellProps) {
  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <header className={styles.header}>
          <h2 className={styles.title}>
            {icon && <span className={styles.titleIcon}>{icon}</span>}
            <span>{title}</span>
          </h2>
          {description && <p className={styles.description}>{description}</p>}
          {headerExtra}
        </header>
        {children}
      </div>
    </div>
  );
}
