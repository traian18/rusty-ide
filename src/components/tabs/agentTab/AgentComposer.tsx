import React from "react";
import { FolderGit2, FileText } from "lucide-react";
import type { WorkflowAnswer, WorkflowQuestion } from "../../../harness/contract";
import { AgentQuestion, ChatInput } from "../../ui/ChatInput";
import { AgentWorkflowBar, type WorkflowChoice } from "../behaviors/AgentWorkflowBar";
import type { JsonObject } from "../behaviors/behaviorModel";
import { WorkflowApprovalCard } from "../behaviors/WorkflowApprovalCard";
import type { useWorkflowRunStore } from "../behaviors/workflowRunStore";
import type { UsageLimitContinue } from "./usageLimit";
import type { AttachedFile } from "./sendMessage";

/** The files the chat changed, each opening on click. */
export function ModifiedFilesBar({ files, onOpen }: { files: string[]; onOpen: (path: string) => void }) {
  if (files.length === 0) return null;
  return (
    <div className="flex items-center space-x-2 px-4 py-1.5 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/30 flex-shrink-0 overflow-x-auto">
      <FolderGit2 size={12} className="text-[var(--color-status-success)] flex-shrink-0" />
      <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-wider flex-shrink-0">Changes:</span>
      {files.map((filePath) => (
        <button
          key={filePath}
          onClick={() => onOpen(filePath)}
          className="flex items-center space-x-1 px-2 py-0.5 bg-[var(--color-surface-app)] border border-[var(--color-border-default)] hover:border-[var(--color-status-success)] rounded text-[10px] font-mono text-[var(--color-fg-strong)] cursor-pointer transition-colors flex-shrink-0"
        >
          <FileText size={10} className="text-[var(--color-status-success)]" />
          <span>{filePath.split("/").pop() || filePath}</span>
        </button>
      ))}
    </div>
  );
}

type WorkflowRuns = ReturnType<typeof useWorkflowRunStore.getState>["runs"];

interface AgentComposerProps {
  workflows: WorkflowChoice[];
  chatWorkflow: string | undefined;
  workflowDocument: JsonObject | undefined;
  workflowRuns: WorkflowRuns;
  workflowRunning: boolean;
  autoAvailable: boolean;
  flowSwitching: boolean;
  autoApprove: boolean;
  onAutoApproveChange: (enabled: boolean) => void;
  onFlowSwitchingChange: (allowed: boolean) => void;
  onSelectWorkflow: (path: string | undefined) => void;
  /** The next message resumes a failed workflow run. */
  resumable: boolean;
  onStartOver: () => void;
  /** The last run stopped at the model provider's usage limit: it can go on once that resets. */
  usageLimit?: UsageLimitContinue;
  workflowQuestion: WorkflowQuestion | undefined;
  onWorkflowAnswer: (answer: WorkflowAnswer) => void;
  message: string;
  onMessageChange: (message: string) => void;
  onSend: (attachedFiles: AttachedFile[]) => void;
  /** Nothing can be sent: a run is going, or the message would need a skill and none is chosen. */
  sendDisabled: boolean;
  isAgentBusy: boolean;
  onStop: () => void;
  agentQuestion: AgentQuestion | null;
  onAgentQuestionAnswer: (answer: string) => void;
  promptHistory: string[];
}

function UsageLimitBanner({ limit }: { limit: UsageLimitContinue }) {
  const at = limit.resetsAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-text-secondary)] py-2" role="status">
      <span>{limit.scheduled ? `The run continues by itself at ${at}, when the usage limit resets.` : `The model provider's usage limit resets at ${at}.`}</span>
      {limit.scheduled ? (
        <button type="button" className="underline" onClick={limit.cancel}>Cancel</button>
      ) : (
        <button type="button" className="underline" onClick={limit.schedule}>Continue at {at}</button>
      )}
    </div>
  );
}

/** Below the chat: the workflow bar, what a failed run or a workflow step
 * asks of the user, and the chat box. */
export const AgentComposer: React.FC<AgentComposerProps> = (props) => (
  <div className="px-3 py-2 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-header)] flex-shrink-0 w-full">
    <AgentWorkflowBar
      workflows={props.workflows}
      selected={props.chatWorkflow}
      definition={props.workflowDocument}
      run={props.workflowDocument ? props.workflowRuns[String(props.workflowDocument.id ?? "")] : undefined}
      running={props.workflowRunning}
      disabled={props.isAgentBusy}
      autoAvailable={props.autoAvailable}
      flowSwitching={props.flowSwitching}
      autoApprove={props.autoApprove}
      onAutoApproveChange={props.onAutoApproveChange}
      onFlowSwitchingChange={props.onFlowSwitchingChange}
      onStop={props.onStop}
      onSelect={props.onSelectWorkflow}
    />
    {props.usageLimit && <UsageLimitBanner limit={props.usageLimit} />}
    {props.resumable && (
      <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-text-secondary)] py-2">
        <span>Your next message resumes the workflow with the findings above. Completed steps are retained.</span>
        <button type="button" className="underline" onClick={props.onStartOver}>Start over instead</button>
      </div>
    )}
    {props.workflowQuestion ? (
      <WorkflowApprovalCard key={props.workflowQuestion.requestId} question={props.workflowQuestion} onAnswer={props.onWorkflowAnswer} />
    ) : null}
    <ChatInput
      value={props.message}
      onChange={props.onMessageChange}
      onSend={props.onSend}
      disabled={props.sendDisabled}
      isStreaming={props.isAgentBusy}
      onStop={props.onStop}
      agentQuestion={props.agentQuestion}
      onAgentQuestionAnswer={props.onAgentQuestionAnswer}
      promptHistory={props.promptHistory}
      placeholder="Message agent... (type @ to reference files) or press ↑ to display last prompts"
    />
  </div>
);
