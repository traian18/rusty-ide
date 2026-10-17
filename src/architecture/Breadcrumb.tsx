import { ChevronRight } from "lucide-react";
import { breadcrumb, type Trail } from "./levels";
import styles from "./Architecture.module.css";

export interface BreadcrumbProps {
  trail: Trail;
  /** What the top of the tree is called (the repository). */
  topLabel: string;
  /** Keeps the first `depth` steps. */
  onGo(depth: number): void;
}

/** The repository, then each folder opened; every earlier crumb is a way back up. */
export function Breadcrumb({ trail, topLabel, onGo }: BreadcrumbProps) {
  const crumbs = breadcrumb(trail, topLabel);
  return (
    <nav className={styles.crumbs} aria-label="Architecture level">
      {crumbs.map((crumb, index) => {
        const last = index === crumbs.length - 1;
        return (
          <span key={`${crumb.depth}:${crumb.label}`} className={styles.toolbarGroup}>
            {index > 0 ? <ChevronRight size={12} className={styles.crumbSeparator} aria-hidden /> : null}
            {last ? (
              <span className={styles.crumbCurrent} aria-current="page">
                {crumb.label}
              </span>
            ) : (
              <button type="button" className={styles.linkButton} onClick={() => onGo(crumb.depth)}>
                {crumb.label}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
