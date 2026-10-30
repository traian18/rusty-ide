import { canvasClient } from "../../client";
import { useWorkspaceStore } from "../../../../store";
import { VfsRegistry } from "../../service/vfs";
import type { AgentQuestion } from "../../../agent-chat/ui";
import { scheduleTreeRefresh } from "../../../explorer/ui";
import { createRunHost } from "../../../../harness/hostDefaults";
import { explorerQuestionResolvers } from "./explorerRunRegistry";

interface ExplorerRunHostParams {
  selectedNode: any;
  selectedNodeId: string;
  tabId: string | undefined;
  addLog: (nodeId: string, message: string) => void;
  onQuestion: (question: AgentQuestion) => void;
}

/** Host callbacks (file access, plan writing, questions) handed to an explorer agent run. */
export function createExplorerRunHost({ selectedNode, selectedNodeId, tabId, addLog, onQuestion }: ExplorerRunHostParams) {
  return createRunHost({
    readFile: async (path) => {
      console.log(`[SidePane] Tool request: read_file ${path}`);
      if (selectedNode?.type === "taskNode" && tabId) {
        const canvasContext = useWorkspaceStore.getState().canvasContexts[tabId];
        const currentNode = canvasContext?.nodes.find((node) => node.id === selectedNodeId);
        const ownFiles = (currentNode?.data?.generatedFileContents as Record<string, string>) || {};
        const connectedUpstreamFiles = new Map<string, string>();
        for (const edge of canvasContext?.edges || []) {
          if (
            edge.target !== selectedNodeId ||
            edge.sourceHandle !== "task-out" ||
            edge.targetHandle !== "task-in"
          ) continue;
          const upstreamNode = canvasContext?.nodes.find((node) => node.id === edge.source);
          const upstreamFiles = (upstreamNode?.data?.generatedFileContents as Record<string, string>) || {};
          Object.entries(upstreamFiles).forEach(([filePath, fileContent]) => {
            connectedUpstreamFiles.set(filePath, fileContent);
          });
        }
        return ownFiles[path] !== undefined
          ? ownFiles[path]
          : connectedUpstreamFiles.has(path)
            ? connectedUpstreamFiles.get(path)!
            : await canvasClient.readFile(path);
      }
      return VfsRegistry.getOrCreate(tabId).readFile(path);
    },
    writeFile: async (path, content) => {
      if (selectedNode?.type === "globalChatNode") {
        const error = "Global Chat is planning-only and cannot write files to the VFS. Use write_plan for plans.";
        addLog(selectedNodeId, error);
        throw new Error(error);
      }
      const store = useWorkspaceStore.getState();
      const currentNode = tabId
        ? store.canvasContexts[tabId]?.nodes.find((node) => node.id === selectedNodeId)
        : undefined;
      const originalFileContents = (currentNode?.data?.originalFileContents as Record<string, string>) || {};
      const generatedFileContents = (currentNode?.data?.generatedFileContents as Record<string, string>) || {};
      let original = originalFileContents[path];
      if (selectedNode?.type === "taskNode" && original === undefined) {
        try {
          original = await canvasClient.readFile(path);
        } catch {
          original = "";
        }
      }

      await VfsRegistry.getOrCreate(tabId).writeFile(path, content, selectedNodeId || undefined);
      if (selectedNode?.type === "taskNode" && selectedNodeId) {
        store.updateTaskNode(selectedNodeId, {
          modifiedFiles: Array.from(new Set([
            ...(((currentNode?.data?.modifiedFiles as string[]) || [])),
            path,
          ])),
          originalFileContents: { ...originalFileContents, [path]: original || "" },
          generatedFileContents: { ...generatedFileContents, [path]: content },
        });
      }
    },
    writePlan: async (filename, content) => {
      if (selectedNode?.type !== "globalChatNode") {
        throw new Error("The write_plan tool is only available to Global Chat.");
      }
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}\.md$/.test(filename)) {
        throw new Error("Plan filename must be a Markdown filename using only letters, numbers, hyphens, or underscores.");
      }
      const planRoot = useWorkspaceStore.getState().rootPath?.replace(/[\\/]+$/, "");
      if (!planRoot) throw new Error("No project root is open.");
      const separator = planRoot.includes("\\") ? "\\" : "/";
      const planPath = `${planRoot}${separator}plans${separator}${filename}`;
      await canvasClient.writeFile(planPath, content, tabId);
      scheduleTreeRefresh();
      addLog(selectedNodeId, `Saved plan to ${planPath}`);
      return planPath;
    },
    askQuestion: (question) =>
      new Promise<string>((resolve) => {
        explorerQuestionResolvers.set(selectedNodeId, resolve);
        onQuestion(question);
      }),
  });
}
