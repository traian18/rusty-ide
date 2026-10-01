import { useEffect, useMemo, useState } from "react";
import { trajectories, useTrajectories } from "../../observability/trajectoryStore";
import styles from "./ToolExecutionPanel.module.css";

export function RunTrajectoryView() {
  const snapshot = useTrajectories();
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const run = snapshot.runs.find((item) => item.id === selected) ?? snapshot.runs[0];
  useEffect(() => { if (run) void trajectories.ensureEntries(run.id); }, [run?.id]);
  const sources = useMemo(() => [...new Set(run?.entries.map((entry) => entry.source) ?? [])], [run]);
  const entries = useMemo(() => run?.entries.filter((entry) =>
    (source === "all" || entry.source === source) &&
    (!query.trim() || JSON.stringify(entry).toLowerCase().includes(query.trim().toLowerCase()))
  ) ?? [], [run, query, source]);
  const loading = Boolean(run && snapshot.loadingEntries.has(run.id));
  const loadError = run ? snapshot.entryErrors.get(run.id) : undefined;
  return <>
    <div className={styles.trajectoryControls}>
      <label>Run
        <select id="trajectory-run-select" aria-label="Select run" value={run?.id ?? ""} onChange={(event) => { setSelected(event.target.value); setSource("all"); }}>
          {snapshot.runs.map((item) => <option key={item.id} value={item.id}>{new Date(item.startedAt).toLocaleString()} · {item.origin.displayLabel} · {item.status}</option>)}
        </select>
      </label>
      <input id="trajectory-search-input" aria-label="Search trajectory" placeholder="Search prompts, tools, results and errors" value={query} onChange={(event) => setQuery(event.target.value)} />
      <select id="trajectory-source-select" aria-label="Filter trajectory source" value={source} onChange={(event) => setSource(event.target.value)}>
        <option value="all">All event sources</option>
        {sources.map((item) => <option key={item}>{item}</option>)}
      </select>
    </div>
    {snapshot.error && <div className={styles.storageError}>Trajectory storage degraded: {snapshot.error}</div>}
    <div className={styles.list}>
      {!run ? <div className={styles.empty}><strong>No run trajectories yet</strong><span>New runs record context and events here. Older tool records remain in Tools.</span></div> : <>
        <div className={styles.detail}>
          <strong>{run.origin.displayLabel} · {run.status}</strong>
          <p className={styles.trajectoryNotice}>Redacted diagnostic history saved under .rusty/observability (the 100 most recent runs in the selected window are listed). Individual payloads are bounded. CLI-internal context is unavailable; “Model request” shows the context supplied to host-routed models.</p>
          <dl className={styles.metadata}>
            <div><dt>Run</dt><dd title={run.id}>{run.id}</dd></div>
            <div><dt>Session</dt><dd title={run.sessionId}>{run.sessionId ?? "Not started"}</dd></div>
            <div><dt>Model</dt><dd>{run.context.model ?? "Not reported"}</dd></div>
            <div><dt>Source</dt><dd>{run.origin.surface}</dd></div>
          </dl>
          {run.omittedEntries > 0 && <p role="status">{run.omittedEntries} older events not shown to keep memory bounded; the full trace is saved in .rusty/observability/trajectories/{run.id}.jsonl.</p>}
          <div className={styles.rowActions}>
            <button id="trajectory-copy-run" type="button" onClick={() => navigator.clipboard?.writeText(JSON.stringify(run, null, 2))}>Copy redacted run</button>
            <button id="trajectory-delete-run" type="button" disabled={run.status === "running"} onClick={() => trajectories.remove((item) => item.id === run.id)}>Delete run trace</button>
          </div>
        </div>
        {loading && <div className={styles.empty} role="status">Loading event trace…</div>}
        {loadError && <div className={styles.storageError}>Could not load this trace: {loadError}</div>}
        {!loading && !loadError && entries.length === 0 && <div className={styles.empty}>No matching events</div>}
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
