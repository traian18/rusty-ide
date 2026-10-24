import { useState } from "react";

import { toRepositoryError } from "../architecture/client";
import { Button, Callout } from "../components/ui";
import type { SpecsClient } from "./client";
import { DocumentView } from "./DocumentView";
import type { ChangeSummary } from "./model";
import type { SpecArchived, SpecStep } from "./model";
import { localDate } from "./pure";
import { useActiveSpecChange } from "./activeChange";
import { SPEC_STEP_TEXT } from "./run";
import { CHANGE_TABS, NEXT_STEP_TEXT, progressText, STATUS_TEXT } from "./pure";
import { useSpecsView } from "./specsState";
import { TasksView } from "./TasksView";
import { Warnings } from "./Warnings";
import styles from "./Specs.module.css";

export interface ChangeViewProps {
  client: SpecsClient;
  root: string;
  specsRoot: string;
  change: ChangeSummary;
  revision: number;
  onChanged(): void;
  onOpenFile(path: string, line?: number): void;
  /** Opens an Agent tab set up to run the step on this change. */
  onRun(step: SpecStep): void;
  /** Called after the change was merged into the capabilities and moved to the archive. */
  onArchived(result: SpecArchived): void;
}

/** Why a step cannot run yet, if it cannot. */
function missingFor(step: SpecStep, documents: readonly string[]): string | undefined {
  if (step === "plan" && !documents.includes("spec.md")) return "Write the spec first";
  if (step === "implement" && !documents.includes("tasks.md")) return "Write the design and tasks first";
  return undefined;
}

/** One change: status and progress, what the files say about it, and a tab per document. */
export function ChangeView({ client, root, specsRoot, change, revision, onChanged, onOpenFile, onRun, onArchived }: ChangeViewProps) {
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const active = useActiveSpecChange((state) => state.byRoot[root] === change.dir);
  const archive = async (force: boolean) => {
    setArchiveError(null);
    try {
      onArchived(await client.archive(root, change.dir, localDate(), force));
    } catch (failure) {
      setArchiveError(toRepositoryError(failure).message);
    }
  };
  const tab = useSpecsView((state) => state.tab);
  const setTab = useSpecsView((state) => state.setTab);
  const base = `${specsRoot}/changes/${change.dir}`;
  const current = CHANGE_TABS.find((candidate) => candidate.id === tab) ?? CHANGE_TABS[1];
  return (
    <section aria-label={`Change ${change.title}`}>
      <header className={styles.header}>
        <h2 className={styles.title}>{change.title}</h2>
        <span className={styles.badge}>{STATUS_TEXT[change.status]}</span>
        {change.number !== null ? <span className={`${styles.badge} ${styles.mono}`}>{String(change.number).padStart(4, "0")}</span> : null}
        <span className={styles.badge}>Tasks {progressText(change)}</span>
        {change.branch ? <span className={`${styles.badge} ${styles.mono}`}>{change.branch}</span> : null}
        <span className={styles.muted}>{change.created ? `Created ${change.created}` : null}</span>
        <span style={{ flex: 1 }} />
        {change.nextStep === "archive" ? <span className={styles.muted}>Next step: {NEXT_STEP_TEXT[change.nextStep]}</span> : null}
        {(["specify", "plan", "implement"] as const).map((step) => (
          <Button key={step} variant={change.nextStep === step ? "primary" : "secondary"} disabled={missingFor(step, change.documents) !== undefined} title={missingFor(step, change.documents)} onClick={() => onRun(step)}>
            {SPEC_STEP_TEXT[step]}
          </Button>
        ))}
        <Button variant={active ? "secondary" : "ghost"} aria-pressed={active} title="Chats and agents are told about this change and its open tasks" onClick={() => useActiveSpecChange.getState().set(root, active ? null : change.dir)}>
          {active ? "Active in chats" : "Use in chats"}
        </Button>
        <Button variant={change.nextStep === "archive" ? "primary" : "ghost"} title="Merge this change into the capability specs and move it to the archive" onClick={() => void archive(false)}>
          Archive
        </Button>
        <Button variant="ghost" onClick={() => onOpenFile(`${base}/${current.file}`)} disabled={!change.documents.includes(current.file)}>
          Edit {current.file}
        </Button>
      </header>
      {archiveError ? (
        <Callout variant="danger">
          {archiveError}
          {archiveError.startsWith("The change is not finished") ? (
            <>
              {" "}
              <Button variant="secondary" onClick={() => void archive(true)}>
                Archive anyway
              </Button>
            </>
          ) : null}
        </Callout>
      ) : null}
      {change.hint ? <p className={styles.muted}>{change.hint}</p> : null}
      <Warnings warnings={change.warnings} onOpen={onOpenFile} />
      <div role="tablist" className={styles.tabs} aria-label="Documents of this change">
        {CHANGE_TABS.map((candidate) => {
          const present = change.documents.includes(candidate.file);
          return (
            <button key={candidate.id} type="button" role="tab" aria-selected={tab === candidate.id} className={`${styles.tab} ${present ? "" : styles.tabAbsent}`} onClick={() => setTab(candidate.id)}>
              {candidate.label}
            </button>
          );
        })}
      </div>
      {current.id === "tasks" && change.documents.includes("tasks.md") ? (
        <TasksView client={client} root={root} change={change} revision={revision} onTicked={onChanged} onOpenFile={onOpenFile} specsRoot={specsRoot} />
      ) : (
        <DocumentView client={client} root={root} path={`${base}/${current.file}`} revision={revision} missing={`${current.file} does not exist yet; it is written by ${current.writtenBy}.`} />
      )}
    </section>
  );
}
