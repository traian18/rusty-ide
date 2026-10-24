import { Callout } from "../components/ui";
import { useLoad } from "../dashboard/useLoad";
import type { SpecsClient } from "./client";
import type { ChangeSummary } from "./model";
import { taskDocument, taskReferences } from "./pure";
import styles from "./Specs.module.css";

export interface TasksViewProps {
  client: SpecsClient;
  root: string;
  change: ChangeSummary;
  revision: number;
  /** Called after a tick was saved, so the page reloads its progress. */
  onTicked(): void;
  onOpenFile(path: string, line?: number): void;
  specsRoot: string;
}

/** The checklist of a change. Ticking edits `tasks.md`; a task with a document of its own links to it. */
export function TasksView({ client, root, change, revision, onTicked, onOpenFile, specsRoot }: TasksViewProps) {
  const loaded = useLoad(() => client.tasks(root, change.dir), [client, root, change.dir, revision]);
  const base = `${specsRoot}/changes/${change.dir}`;
  if (loaded.error) return <Callout variant="danger">{loaded.error}</Callout>;
  if (loaded.loading && loaded.value === null) return <div role="status">Loading…</div>;
  const tasks = loaded.value ?? [];
  if (!tasks.length) return <p className={styles.muted}>There are no tasks yet. The Plan step writes tasks.md.</p>;
  const tick = (id: string, done: boolean) => void client.tick(root, change.dir, id, done).then(onTicked);
  return (
    <ul className={styles.tasks} aria-label="Tasks">
      {tasks.map((task) => {
        const document = taskDocument(task, change.taskDocuments);
        const references = taskReferences(task);
        return (
          <li key={task.id} className={styles.task}>
            <input type="checkbox" checked={task.done} aria-label={`${task.id} ${task.title}`} onChange={(event) => tick(task.id, event.target.checked)} />
            <div className={styles.taskBody}>
              <div className={task.done ? styles.taskDone : styles.taskTitle}>
                <strong>{task.id}</strong> {task.title}
              </div>
              {references ? <div className={styles.muted}>{references}</div> : null}
              {task.instructions ? (
                <details>
                  <summary className={styles.muted}>Instructions</summary>
                  <p className={styles.muted} style={{ whiteSpace: "pre-wrap" }}>
                    {task.instructions}
                  </p>
                </details>
              ) : null}
              {document ? (
                <button type="button" className={styles.warning} onClick={() => onOpenFile(`${base}/tasks/${document}`)}>
                  Open {document}
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
