import React from "react";
import { useExplorerWebSocket } from "./useExplorerWebSocket";
import { ExplorerChatContent } from "./components/ExplorerChatContent";
import { PromptChatContent } from "./components/PromptChatContent";

/**
 * Assembles the explorer chat content for global chat nodes.
 */
export function buildGlobalChatContent(
  selectedNode: any,
  nodeStatus: string,
  explorer: ReturnType<typeof useExplorerWebSocket>,
  onCreateTaskNodes: (tasks: any[], contexts: any[]) => Promise<void>
): React.ReactNode {
  return (
    <ExplorerChatContent
      selectedNode={selectedNode}
      nodeStatus={nodeStatus}
      explorerInput={explorer.explorerInput}
      setExplorerInput={explorer.setExplorerInput}
      handleExplorerSendMessage={explorer.handleExplorerSendMessage}
      generatedTaskDraft={explorer.generatedTaskDraft}
      setGeneratedTaskDraft={explorer.setGeneratedTaskDraft}
      generatedContextDraft={explorer.generatedContextDraft}
      setGeneratedContextDraft={explorer.setGeneratedContextDraft}
      isTaskGenerationPromptOpen={explorer.isTaskGenerationPromptOpen}
      setIsTaskGenerationPromptOpen={explorer.setIsTaskGenerationPromptOpen}
      taskGenerationInstructions={explorer.taskGenerationInstructions}
      setTaskGenerationInstructions={explorer.setTaskGenerationInstructions}
      taskGenerationFailure={explorer.taskGenerationFailure}
      taskGenerationModel={explorer.taskGenerationModel}
      isGeneratingTasks={explorer.isGeneratingTasks}
      handleGenerateTaskDraft={explorer.handleGenerateTaskDraft}
      onCreateTaskNodes={onCreateTaskNodes}
      handleStopExplorer={explorer.handleStopExplorer}
      streamingMessageId={explorer.streamingMessageId}
      exploreModel={explorer.exploreModel}
      summarizeModel={explorer.summarizeModel}
      allAvailableModels={explorer.allAvailableModels}
      unauthenticatedProviders={explorer.unauthenticatedProviders}
      subagents={explorer.subagents}
      agentQuestion={explorer.agentQuestion}
      handleAgentQuestionAnswer={explorer.handleAgentQuestionAnswer}
    />
  );
}

/**
 * Assembles the prompt chat content for non-global-chat nodes (task, context).
 */
export function buildPromptChatContent(
  selectedNode: any,
  nodeStatus: string,
  explorer: ReturnType<typeof useExplorerWebSocket>
): React.ReactNode {
  return (
    <PromptChatContent
      selectedNode={selectedNode}
      nodeStatus={nodeStatus}
      explorerInput={explorer.explorerInput}
      setExplorerInput={explorer.setExplorerInput}
      handleExplorerSendMessage={explorer.handleExplorerSendMessage}
      handleStopExplorer={explorer.handleStopExplorer}
      streamingMessageId={explorer.streamingMessageId}
      subagents={explorer.subagents}
      agentQuestion={explorer.agentQuestion}
      handleAgentQuestionAnswer={explorer.handleAgentQuestionAnswer}
    />
  );
}
