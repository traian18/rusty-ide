import { useEffect } from "react";

import { Button } from "../components/ui";
import { backgroundClient, type BackgroundClient, type Job } from "./client";
import { useBackground } from "./backgroundStore";
import styles from "./ProcessBubble.module.css";

/** Finished jobs disappear after this long; failed ones stay until dismissed. */
export const FINISHED_VISIBLE_MS = 6_000;

const OUTCOME: Record<Job["state"], string> = {
  running: "Working…",
  finished: "Done",
  failed: "Failed",
  cancelled: "Stopped",
};

function JobCard({ job, onClose }: { job: Job; onClose(): void }) {
  const running = job.state === "running";
  const percent = running && job.total ? Math.min(100, Math.round(((job.done ?? 0) / job.total) * 100)) : undefined;
  return (
    <section className={styles.card} aria-label={job.label}>
      <div className={styles.heading}>
        <strong>{job.label}</strong>
        <button type="button" onClick={onClose} aria-label={running ? `Stop ${job.label}` : `Dismiss ${job.label}`} title={running ? "Stop" : "Dismiss"}>
          ×
        </button>
      </div>
      <p className={styles.detail} role="status">
        {running ? job.detail ?? "Working…" : OUTCOME[job.state]}
      </p>
      {running ? (
        <div className={styles.track} role="progressbar" aria-label={job.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <span className={percent === undefined ? styles.indeterminate : styles.fill} style={percent === undefined ? undefined : { width: `${percent}%` }} />
        </div>
      ) : null}
      {job.state === "failed" && job.message ? <p className={styles.failed} role="alert">{job.message}</p> : null}
    </section>
  );
}

/**
 * Bottom-left list of what runs in the background (analysis, documentation updates) and questions
 * waiting for an answer. Each job has its own ×: on a running job it stops it.
 */
export function ProcessBubble({ client = backgroundClient }: { client?: Pick<BackgroundClient, "cancel"> }) {
  const jobs = useBackground((state) => state.jobs);
  const questions = useBackground((state) => state.questions);
  const answer = useBackground((state) => state.answer);

  // Finished jobs leave by themselves after a moment; failures wait to be read.
  useEffect(() => {
    const done = jobs.filter((job) => job.state === "finished" || job.state === "cancelled");
    if (!done.length) return;
    const timer = setTimeout(() => done.forEach((job) => void client.cancel(job.id).catch(() => undefined)), FINISHED_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [jobs, client]);

  if (!jobs.length && !questions.length) return null;
  return (
    <div className={styles.container} aria-label="Background processes">
      {questions.map((question) => (
        <section key={question.id} className={styles.card} aria-label={question.title}>
          <div className={styles.heading}>
            <strong>{question.title}</strong>
            <button type="button" onClick={() => answer(question.id)} aria-label={`Dismiss ${question.title}`}>
              ×
            </button>
          </div>
          <p className={styles.detail}>{question.message}</p>
          <div className={styles.actions}>
            <Button
              variant="primary"
              onClick={() => {
                answer(question.id);
                question.onAccept();
              }}
            >
              {question.accept}
            </Button>
            <Button variant="ghost" onClick={() => answer(question.id)}>
              Not now
            </Button>
          </div>
        </section>
      ))}
      {jobs.map((job) => (
        <JobCard key={job.id} job={job} onClose={() => void client.cancel(job.id).catch(() => undefined)} />
      ))}
    </div>
  );
}
