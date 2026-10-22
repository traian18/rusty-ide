import { FileCode2, Trash2 } from "lucide-react";
import { useWorkspaceStore } from "../../../store";
import { executionObservability } from "../../../observability/executionStore";
import { ACTIVE_STATUSES } from "../../../observability/toolCallRecords";
import type { ExecutionTokensSnapshot, RunUsage, ToolExecutionDetail, ToolExecutionRecord } from "../../../observability/types";
import { describeCallModels, extractCallSummary, formatToolExecutor } from "../callSummary";
import styles from "../ToolExecutionPanel.module.css";
import { CopyableSection, JsonValue, MetaField, OptionalMetaField, Pill, RunContextSection } from "./DetailParts";
import { formatDateTime, formatTime } from "./format";
import { RunTokenUsage, TokenGrid } from "./TokenUsage";

type CallModels = ReturnType<typeof describeCallModels>;

/** What the call is: tool, models, and the action it takes. */
function CallBanner({ record, models }: { record: ToolExecutionRecord; models: CallModels }) {
  const callSummary = extractCallSummary(record);
  const executor = record.execution?.executor;
  return (
    <div className={styles.callBanner}>
      <div className={styles.callBannerTop}>
        <span className={styles.callBannerBadge}>
          <FileCode2 size={15} className="text-[var(--color-primary)]" />
          {record.toolName}
        </span>
        <Pill label="Executed by:" title={`Executed by ${models.executedBy}`}>{executor ? formatToolExecutor(executor) : models.executedBy}</Pill>
        <Pill label="Requested by:" title={`Requested by ${models.requestedBy}`}>{models.requestedBy}</Pill>
        {record.status === "running" && (
          <span className={`${styles.status} ${styles.status_running}`} />
        )}
      </div>
      <div className={styles.callHeadline}>{callSummary.actionLabel}</div>
      {callSummary.summary && (
        <p className="text-[var(--color-fg-default)] text-xs font-sans m-0 font-medium">{callSummary.summary}</p>
      )}
      {callSummary.description && (
        <p className="text-[var(--color-fg-default)] text-xs font-sans m-0">{callSummary.description}</p>
      )}
      {callSummary.instruction && (
        <p className="text-[var(--color-fg-muted)] text-xs font-mono m-0 italic">{callSummary.instruction}</p>
      )}
      {callSummary.keyParams.length > 0 && (
        <div className={styles.callKeyParams}>
          {callSummary.keyParams.map((p: { label: string; value: string }) => (
            <Pill key={p.label} label={`${p.label}:`}>{p.value}</Pill>
          ))}
        </div>
      )}
    </div>
  );
}

/** What the tool itself reported through its ToolExecutionObserver. */
function ToolExecutionSection({ execution }: { execution: ToolExecutionDetail }) {
  const { executor, tokens, steps } = execution;
  return (
    <section className={styles.detailSection} aria-label="Tool execution">
      <h4>Tool Execution {executor && <small>{executor.purpose}</small>}</h4>
      {executor && (
        <dl className={styles.metadata}>
          {executor.model && <MetaField label="Executed by model" title={executor.model}>{executor.model}</MetaField>}
          {executor.provider && <MetaField label={executor.kind === "service" ? "Executed by service" : "Provider"} title={executor.provider}>{executor.provider}</MetaField>}
        </dl>
      )}
      {tokens && <TokenGrid tokens={tokens} />}
      {steps.length > 0 && (
        <ol className={styles.executionSteps}>
          {steps.map((step, index) => (
            <li key={`${step.at}-${index}`} className={step.level === "info" ? undefined : styles[`executionStep_${step.level}`]}>
              <span className={styles.executionStepTime}>{formatTime(step.at)}</span>
              {step.details === undefined ? (
                <span>{step.message}</span>
              ) : (
                <details>
                  <summary>{step.message}</summary>
                  <JsonValue value={step.details} />
                </details>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function SelectionInfo({ selection }: { selection: NonNullable<ToolExecutionRecord["context"]["selection"]> }) {
  return (
    <div className={styles.selectionInfo}>
      <span className={styles.selectionLabel}>Target file selection:</span>
      <code className={styles.selectionCode}>
        {selection.filePath}{selection.lineRange ? `:${selection.lineRange}` : ""}
      </code>
      {selection.textPreview && (
        <pre className={styles.code}>{selection.textPreview}</pre>
      )}
    </div>
  );
}

function ProgressSection({ progress }: { progress: NonNullable<ToolExecutionRecord["progress"]> }) {
  return (
    <section className={styles.detailSection}>
      <h4>Progress</h4>
      <div className={styles.progress}><span style={{ width: `${Math.max(0, Math.min(1, progress.fraction)) * 100}%` }} /></div>
      <p>{progress.status} · {Math.round(progress.fraction * 100)}%</p>
    </section>
  );
}

function CallMetadata({ record, models }: { record: ToolExecutionRecord; models: CallModels }) {
  return (
    <section className={styles.detailSection}>
      <h4>Call Metadata</h4>
      <dl className={styles.metadata}>
        <MetaField label="Source">{record.origin.displayLabel}</MetaField>
        <MetaField label="Surface">{record.origin.surface}</MetaField>
        <OptionalMetaField label="Canvas" value={record.origin.canvasId} />
        <OptionalMetaField label="Node" value={record.origin.nodeId} />
        <MetaField label="Capability">{record.context.capability}</MetaField>
        <MetaField label="Executed by" title={models.executedBy}>{models.executedBy}</MetaField>
        <MetaField label="Requested by model" title={models.requestedBy}>{models.requestedBy}</MetaField>
        <OptionalMetaField label="Requesting provider" value={record.requestedBy?.provider ?? record.context.provider} />
        <MetaField label="Session">{record.sessionId ?? "—"}</MetaField>
        <MetaField label="Agent">{record.agentId ?? "—"}</MetaField>
        <OptionalMetaField label="Parent agent" value={record.parentAgentId} />
        <MetaField label="Call ID">{record.callId}</MetaField>
        <MetaField label="Requested">{formatDateTime(record.requestedAt)}</MetaField>
        <OptionalMetaField label="Started" value={record.startedAt} format={formatDateTime} />
        <OptionalMetaField label="Finished" value={record.finishedAt} format={formatDateTime} />
        <OptionalMetaField label="Permission" value={record.permission?.state} />
      </dl>
    </section>
  );
}

function RecordActions({ record }: { record: ToolExecutionRecord }) {
  const active = ACTIVE_STATUSES.has(record.status);
  const sourceTabId = record.origin.tabId ?? record.origin.canvasId;
  const canOpenSource = useWorkspaceStore((state) => Boolean(sourceTabId && state.tabs.some((tab) => tab.id === sourceTabId)));
  const activateTab = useWorkspaceStore((state) => state.activateTab);
  const setSelectedNodeId = useWorkspaceStore((state) => state.setSelectedNodeId);
  const openSource = () => {
    activateTab(sourceTabId!);
    if (record.origin.nodeId) setSelectedNodeId(record.origin.nodeId);
  };
  return (
    <div className={styles.rowActions}>
      {canOpenSource && <button type="button" onClick={openSource}>Open source</button>}
      <button type="button" onClick={() => navigator.clipboard?.writeText(JSON.stringify(record, null, 2))}>Copy redacted record</button>
      <button type="button" disabled={active} title={active ? "Active executions cannot be deleted" : undefined} onClick={() => executionObservability.deleteExecution(record.id)}><Trash2 size={13} /> Delete</button>
      {record.sessionId && <button type="button" disabled={active} onClick={() => executionObservability.deleteSession(record.sessionId!)}>Delete session</button>}
      {record.origin.workspaceId && <button type="button" disabled={active} onClick={() => executionObservability.deleteWorkspace(record.origin.workspaceId!)}>Delete workspace history</button>}
    </div>
  );
}

export function ExecutionDetail({ record, runTokens, runUsage }: { record: ToolExecutionRecord; runTokens?: ExecutionTokensSnapshot; runUsage?: RunUsage }) {
  const models = describeCallModels(record);
  const { requestPrompt, selection } = record.context;
  return (
    <div className={styles.detail}>
      <CallBanner record={record} models={models} />

      <CopyableSection
        heading={<>Call Arguments <small>{record.payloadState}</small></>}
        copy={{ title: "Copy call arguments", label: "Copy arguments", text: () => JSON.stringify(record.arguments, null, 2) }}
      >
        <JsonValue value={record.arguments} />
      </CopyableSection>

      {record.resultPreview !== undefined && (
        <CopyableSection heading="Call Output" copy={{ title: "Copy output", label: "Copy result", text: () => String(record.resultPreview) }}>
          <JsonValue value={record.resultPreview} />
        </CopyableSection>
      )}

      {record.execution && <ToolExecutionSection execution={record.execution} />}

      {(requestPrompt || selection) && (
        <RunContextSection
          prompt={requestPrompt}
          notice="All tool calls within this run share the same initiating user request. What this specific call does is shown in the Call Action banner above."
        >
          {selection && <SelectionInfo selection={selection} />}
        </RunContextSection>
      )}

      <RunTokenUsage usage={runUsage} tokens={runTokens ?? record.tokens} />

      {record.progress && <ProgressSection progress={record.progress} />}

      <CallMetadata record={record} models={models} />

      <RecordActions record={record} />
    </div>
  );
}
