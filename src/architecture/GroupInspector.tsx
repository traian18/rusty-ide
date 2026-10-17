import { Button } from "../components/ui";
import { isSyntheticId } from "./levels";
import { SeverityPill } from "./SeverityPill";
import { SEVERITY_ORDER } from "./graphModel";
import type { GroupSummary, SeverityCounts } from "./model";
import styles from "./Architecture.module.css";

const BASIS_TEXT = {
  declared: "Declared by a manifest",
  inferred: "Inferred from layout; not a proven dependency",
  derived: "Computed from import edges",
} as const;

export interface GroupInspectorProps {
  group: GroupSummary;
  badges: SeverityCounts | null;
  /** Imports crossing the group's edge, known while the group is open. */
  boundary: { outgoing: number; incoming: number } | null;
  onOpen(groupId: string): void;
}

export function GroupInspector({ group, badges, boundary, onOpen }: GroupInspectorProps) {
  return (
    <div>
      <h3 className={styles.title}>{group.label}</h3>
      <p className={styles.muted}>
        {group.kind.replace("_", " ")} · {group.member_count} file{group.member_count === 1 ? "" : "s"} · {BASIS_TEXT[group.basis]}
      </p>
      <div className={styles.section}>
        <h4 className={styles.sectionTitle}>Why this group exists</h4>
        <p>{group.explanation}</p>
        {group.involves_type_only ? <p className={styles.caveat}>This cycle exists only through type-only imports, which are erased at runtime.</p> : null}
      </div>
      {badges ? (
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>Findings</h4>
          <span className={styles.toolbarGroup}>
            {SEVERITY_ORDER.filter((severity) => badges[severity] > 0).map((severity) => (
              <SeverityPill key={severity} severity={severity} count={badges[severity]} />
            ))}
          </span>
        </div>
      ) : null}
      {boundary ? (
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>Imports across the boundary</h4>
          <p>
            {boundary.outgoing} outgoing · {boundary.incoming} incoming
          </p>
        </div>
      ) : null}
      {isSyntheticId(group.id) ? null : (
        <Button variant="primary" onClick={() => onOpen(group.id)}>
          Open files
        </Button>
      )}
    </div>
  );
}
