import { useMemo, useState } from "react";
import { trajectories, useTrajectories } from "../../observability/trajectoryStore";
import styles from "./ToolExecutionPanel.module.css";

export function RunTrajectoryView() {
  const snapshot = useTrajectories();
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const run = snapshot.runs.find((item) => item.id === selected) ?? snapshot.runs[0];
  const sources = useMemo(() => [...new Set(run?.entries.map((entry) => entry.source) ?? [])], [run]);
  const entries = useMemo(() => run?.entries.filter((entry) =>
    (source === "all" || entry.source === source) &&
    (!query.trim() || JSON.stringify(entry).toLowerCase().includes(query.trim().toLowerCase()))
  ) ?? [], [run, query, source]);
  return <>
    <div className={styles.trajectoryControls}>
      <label>Run
        <select aria-label="Select run" value={run?.id ?? ""} onChange={(event) => { setSelected(event.target.value); setSource("all"); }}>
          {snapshot.runs.map((item) => <option key={item.id} value={item.id}>{new Date(item.startedAt).toLocaleString()} · {item.origin.displayLabel} · {item.status}</option>)}
        </select>
      </label>
      <input aria-label="Search trajectory" placeholder="Search prompts, tools, results and errors" value={query} onChange={(event) => setQuery(event.target.value)} />
      <select aria-label="Filter trajectory source" value={source} onChange={(event) => setSource(event.target.value)}>
        <option value="all">All event sources</option>
        {sources.map((item) => <option key={item}>{item}</option>)}
      </select>
    </div>
    {snapshot.error && <div className={styles.storageError}>Trajectory storage degraded: {snapshot.error}</div>}
    <div className={styles.list}>
      {!run ? <div className={styles.empty}><strong>No run trajectories yet</strong><span>New runs record context and events here. Older tool records remain in Tools.</span></div> : <>
        <div className={styles.detail}>
          <strong>{run.origin.displayLabel} · {run.status}</strong>
          <p className={styles.trajectoryNotice}>Local, redacted diagnostic history (up to 100 recent runs). Payloads and retention are bounded. CLI-internal context is unavailable; “Model request” shows the context supplied to host-routed models.</p>
          <dl className={styles.metadata}>
            <div><dt>Run</dt><dd title={run.id}>{run.id}</dd></div>
            <div><dt>Session</dt><dd title={run.sessionId}>{run.sessionId ?? "Not started"}</dd></div>
            <div><dt>Model</dt><dd>{run.context.model ?? "Not reported"}</dd></div>
            <div><dt>Source</dt><dd>{run.origin.surface}</dd></div>
          </dl>
          {run.omittedEntries > 0 && <p role="status">{run.omittedEntries} older events omitted by the local storage limit.</p>}
          <div className={styles.rowActions}>
            <button type="button" onClick={() => navigator.clipboard?.writeText(JSON.stringify(run, null, 2))}>Copy redacted run</button>
            <button type="button" disabled={run.status === "running"} onClick={() => trajectories.remove((item) => item.id === run.id)}>Delete run trace</button>
          </div>
        </div>
        {entries.length === 0 && <div className={styles.empty}>No matching events</div>}
        {entries.map((entry, index) => <details key={entry.id} className={styles.trajectoryEntry}>
          <summary><span>{entry.sequence ?? index + 1} · {entry.source}</span><small>{new Date(entry.timestamp).toLocaleTimeString()} · {entry.payloadState}</small></summary>
          <div className={styles.detail}>
            {entry.agentId && <p>Agent: {entry.agentId}</p>}
            {(entry.eventCount ?? 0) > 1 && <p>{entry.eventCount} streamed chunks grouped in order · sequence {entry.sequence}–{entry.lastSequence}</p>}
            <pre className={styles.code}>{JSON.stringify(entry.payload, null, 2)}</pre>
          </div>
        </details>)}
      </>}
    </div>
  </>;
}
