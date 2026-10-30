import { type ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button } from "../../../lib/ui";
import type { SpecsOverview } from "../model";
import { groupChanges, progressText, STATUS_TEXT } from "../pure";
import { type Selection } from "../specsState";
import styles from "./Specs.module.css";

export function EmptyState({ banner, owner, onSetUp, onNew, onStart, root }: { banner: ReactNode; owner: string; onSetUp(): void; onNew(): void; onStart(): void; root: string }) {
  return (
    <div className={styles.centered}>
      {banner}
      <p>{owner} has no specs yet.</p>
      <p className={styles.muted}>
        Specs are Markdown files under <code>{root}/</code>: a project description, what the system does, and one folder per change with its spec, design and tasks. For a project that already exists, <strong>Onboard this project</strong> surveys the code and proposes its capabilities for you to review before their specs are written. <strong>Set up specs</strong> only writes a README and a project template; no model is used.
      </p>
      <div className={styles.actions}>
        <Button variant="primary" onClick={onStart} title="A model reads the code (or your description), writes the project file and proposes the capabilities as a list for you to review; each capability's spec is written after that">
          Onboard this project
        </Button>
        <Button variant="secondary" onClick={onSetUp}>
          Set up specs
        </Button>
        <Button variant="secondary" icon={<Plus size={14} />} onClick={onNew}>
          New change
        </Button>
      </div>
    </div>
  );
}

export interface NavProps {
  overview: SpecsOverview;
  selection: Selection;
  onSelect(selection: Selection): void;
  onNew(): void;
}

export function SpecsNav({ overview, selection, onSelect, onNew }: NavProps) {
  const current = (candidate: Selection) => JSON.stringify(candidate) === JSON.stringify(selection);
  return (
    <nav className={styles.nav} aria-label="Specs">
      <div className={styles.actions} style={{ padding: "var(--space-1) var(--space-2)" }}>
        <Button variant="secondary" icon={<Plus size={14} />} onClick={onNew}>
          New change
        </Button>
      </div>
      <div className={styles.group}>Project</div>
      <NavRow label="Project" meta={overview.projectWarnings.length ? "!" : ""} current={current({ kind: "project" })} onClick={() => onSelect({ kind: "project" })} />
      {overview.capabilities.length ? <div className={styles.group}>Capabilities</div> : null}
      {overview.capabilities.map((capability) => (
        <NavRow key={capability.name} label={capability.title} meta={`${capability.warnings.length ? "! " : ""}${capability.requirements}`} current={current({ kind: "capability", name: capability.name })} onClick={() => onSelect({ kind: "capability", name: capability.name })} />
      ))}
      {groupChanges(overview.changes).map((group) => (
        <div key={group.status}>
          <div className={styles.group}>{STATUS_TEXT[group.status]}</div>
          {group.changes.map((change) => (
            <NavRow key={change.dir} label={`${change.number !== null ? `${String(change.number).padStart(4, "0")} ` : ""}${change.title}`} meta={progressText(change)} current={current({ kind: "change", dir: change.dir })} onClick={() => onSelect({ kind: "change", dir: change.dir })} />
          ))}
        </div>
      ))}
      {overview.archive.length ? (
        <details>
          <summary className={styles.group}>Archive ({overview.archive.length})</summary>
          {overview.archive.map((archived) => (
            <NavRow key={archived.dir} label={archived.title} meta="" current={current({ kind: "archived", dir: archived.dir })} onClick={() => onSelect({ kind: "archived", dir: archived.dir })} />
          ))}
        </details>
      ) : null}
    </nav>
  );
}

export function NavRow({ label, meta, current, onClick }: { label: string; meta: string; current: boolean; onClick(): void }) {
  return (
    <button type="button" className={styles.row} aria-current={current ? "true" : undefined} onClick={onClick}>
      <span className={styles.rowLabel} title={label}>
        {label}
      </span>
      <span className={styles.rowMeta}>{meta}</span>
    </button>
  );
}
