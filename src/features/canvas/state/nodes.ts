import { type Edge, type Node } from "@xyflow/react";
import { BUILT_IN_SKILL_IDS, GLOBAL_CHAT_DEFAULT_SKILL_ID } from "../../skills";
import { VfsRegistry } from "../service/vfs";
import { findTabIdByNodeId, getActiveCanvasTabId, getOrCreateContext, updateContextAndSync, canvasHasGlobalChatNode } from "../model/canvasHelpers";
import type { WorkspaceSliceCreator } from "../../../store/sliceTypes";
import { calculateTaskDepths, estimateContextNodeHeight, estimateTaskNodeHeight, findAvailablePosition, GENERATED_CONTEXT_HEIGHT, GENERATED_CONTEXT_WIDTH, GENERATED_NODE_GAP_X, GENERATED_TASK_WIDTH, type LayoutRect } from "../model/generatedGraphLayout";

export const nodesSlice: WorkspaceSliceCreator = (set) => ({
  addContextNode: (x, y, fileContext, tabId) => set((state) => {
    const targetTabId = tabId || getActiveCanvasTabId(state);
    const id = `context_${Date.now()}`;
    const context = getOrCreateContext(state, targetTabId);
    let finalX = x;
    let finalY = y;
    let attempts = 0;
    while (context.nodes.some((node) => Math.abs(node.position.x - finalX) < 60
      && Math.abs(node.position.y - finalY) < 60) && attempts < 100) {
      finalX += 50;
      finalY += 50;
      attempts++;
    }
    const newNode: Node = {
      id,
      type: "contextNode",
      position: { x: finalX, y: finalY },
      data: {
        id,
        name: fileContext ? `Context: ${fileContext.name}` : "",
        description: "",
        path: fileContext?.path || "",
        fileName: fileContext?.name || "",
        isDir: fileContext?.isDir || false,
      },
    };
    return updateContextAndSync(state, targetTabId, (current) => ({
      nodes: [...current.nodes, newNode],
    }), true);
  }),
  addTaskNode: (x, y, tabId) => set((state) => {
    const targetTabId = tabId || getActiveCanvasTabId(state);
    const id = `task_${Date.now()}`;
    const context = getOrCreateContext(state, targetTabId);
    let finalX = x;
    let finalY = y;
    let attempts = 0;
    while (context.nodes.some((node) => Math.abs(node.position.x - finalX) < 60
      && Math.abs(node.position.y - finalY) < 60) && attempts < 100) {
      finalX += 50;
      finalY += 50;
      attempts++;
    }
    const newNode: Node = {
      id,
      type: "taskNode",
      position: { x: finalX, y: finalY },
      data: {
        id,
        name: "AI Executor Node",
        prompt: "",
        model: state.activeModel,
        status: "idle",
        skillId: BUILT_IN_SKILL_IDS.BUILD,
        isMinimized: true,
      },
    };
    return updateContextAndSync(state, targetTabId, (current) => ({
      nodes: [...current.nodes, newNode],
    }), true);
  }),
  addTaskNodesBatch: (tabId, anchorNodeId, tasks, generatedContexts = []) => {
    const createdIds: string[] = [];
    set((state) => {
      const context = getOrCreateContext(state, tabId);
      const anchor = context.nodes.find((node) => node.id === anchorNodeId);
      if (!anchor || tasks.length === 0) return {};
      const taskSpecs = tasks.slice(0, 20);
      const contextSpecs = generatedContexts.slice(0, 30);
      const anchorWidth = Number(anchor.data?.width) || 384;
      const occupied: LayoutRect[] = context.nodes.map((node) => ({
        x: node.position.x,
        y: node.position.y,
        width: Number(node.measured?.width || node.width || node.data?.width)
          || (node.type === "taskNode" ? GENERATED_TASK_WIDTH : node.type === "contextNode" ? GENERATED_CONTEXT_WIDTH : 260),
        height: Number(node.measured?.height || node.height || node.data?.height)
          || (node.type === "taskNode"
            ? estimateTaskNodeHeight(String(node.data?.prompt || ""), !!node.data?.isMinimized)
            : node.type === "contextNode"
              ? estimateContextNodeHeight(String(node.data?.description || ""), !!node.data?.isMinimized)
              : 160),
      }));
      const newTaskNodes: Node[] = [];
      const newContextNodes: Node[] = [];
      const taskEntries = taskSpecs.map((task, index) => ({
        task,
        key: task.key || `task-${index + 1}`,
        id: `task_${crypto.randomUUID()}`,
      }));
      const idByKey = new Map(taskEntries.map(({ key, id }) => [key, id]));
      const taskDepths = calculateTaskDepths(taskSpecs);
      const hasContexts = contextSpecs.length > 0;
      const contextColumnX = anchor.position.x + anchorWidth + GENERATED_NODE_GAP_X;
      const taskColumnStartX = contextColumnX
        + (hasContexts ? GENERATED_CONTEXT_WIDTH + GENERATED_NODE_GAP_X : 0);
      const taskRectsByKey = new Map<string, LayoutRect>();

      taskEntries.forEach(({ task, key, id }) => {
        const depth = taskDepths.get(key) || 0;
        const taskHeight = estimateTaskNodeHeight(task.description);
        const candidate = findAvailablePosition(occupied, {
          x: taskColumnStartX + depth * (GENERATED_TASK_WIDTH + GENERATED_NODE_GAP_X),
          y: anchor.position.y,
          width: GENERATED_TASK_WIDTH,
          height: taskHeight,
        });
        createdIds.push(id);
        occupied.push(candidate);
        taskRectsByKey.set(key, candidate);
        newTaskNodes.push({
          id,
          type: "taskNode",
          position: { x: candidate.x, y: candidate.y },
          data: {
            id,
            name: task.title,
            prompt: task.description,
            model: state.activeModel,
            status: "idle",
            sourceGlobalChatNodeId: anchorNodeId,
            skillId: BUILT_IN_SKILL_IDS.BUILD,
            isMinimized: true,
          },
        });
      });

      const contextEntries = contextSpecs.map((snippet, index) => ({
        snippet,
        key: snippet.key || `context-${index + 1}`,
        id: `context_${crypto.randomUUID()}`,
      }));
      const contextRectsByKey = new Map<string, LayoutRect>();
      contextEntries.forEach(({ snippet, key, id }) => {
        const targetRects = snippet.taskKeys
          .map((taskKey) => taskRectsByKey.get(taskKey))
          .filter((rect): rect is LayoutRect => rect !== undefined);
        if (!targetRects.length || !snippet.content.trim()) return;
        const preferredY = Math.min(...targetRects.map((rect) => rect.y));
        const candidate = findAvailablePosition(occupied, {
          x: contextColumnX,
          y: preferredY,
          width: GENERATED_CONTEXT_WIDTH,
          height: GENERATED_CONTEXT_HEIGHT,
        });
        occupied.push(candidate);
        contextRectsByKey.set(key, candidate);
        newContextNodes.push({
          id,
          type: "contextNode",
          position: { x: candidate.x, y: candidate.y },
          data: {
            id,
            name: snippet.title,
            description: snippet.content,
            path: "",
            fileName: "",
            isDir: false,
            isMinimized: true,
            sourceGlobalChatNodeId: anchorNodeId,
            generatedContextKey: key,
          },
        });
      });
      const seenConnections = new Set<string>();
      const dependencyEdges: Edge[] = [];
      taskEntries.forEach(({ task, id: target }) => {
        for (const dependencyKey of task.dependsOn || []) {
          const source = idByKey.get(dependencyKey);
          const connectionKey = `${source}->${target}`;
          if (!source || source === target || seenConnections.has(connectionKey)) continue;
          seenConnections.add(connectionKey);
          dependencyEdges.push({
            id: `edge_${crypto.randomUUID()}`,
            source,
            sourceHandle: "task-out",
            target,
            targetHandle: "task-in",
          });
        }
      });
      const contextEdges: Edge[] = [];
      contextEntries.forEach(({ snippet, key, id: source }) => {
        const contextRect = contextRectsByKey.get(key);
        if (!contextRect) return;
        for (const taskKey of snippet.taskKeys) {
          const target = idByKey.get(taskKey);
          const taskRect = taskRectsByKey.get(taskKey);
          const connectionKey = `${source}->${target}`;
          if (!target || !taskRect || seenConnections.has(connectionKey)) continue;
          seenConnections.add(connectionKey);
          const contextCenterY = contextRect.y + contextRect.height / 2;
          const taskCenterY = taskRect.y + taskRect.height / 2;
          const contextIsAbove = contextCenterY <= taskCenterY;
          contextEdges.push({
            id: `edge_${crypto.randomUUID()}`,
            source,
            sourceHandle: contextIsAbove ? "context-out-bottom" : "context-out-top",
            target,
            targetHandle: contextIsAbove ? "context-in-top" : "context-in-bottom",
            style: { stroke: "var(--color-status-success-solid)", strokeWidth: 2 },
          });
        }
      });
      return updateContextAndSync(state, tabId, () => ({
        nodes: [...context.nodes, ...newContextNodes, ...newTaskNodes],
        edges: [...context.edges, ...dependencyEdges, ...contextEdges],
      }), true);
    });
    return createdIds;
  },
  addGlobalChatNode: (x, y, tabId) => set((state) => {
    const targetTabId = tabId || getActiveCanvasTabId(state);
    if (canvasHasGlobalChatNode(state, targetTabId)) return {};
    const id = `global_chat_${Date.now()}`;
    const context = getOrCreateContext(state, targetTabId);
    let finalX = x;
    let finalY = y;
    let attempts = 0;
    while (context.nodes.some((node) => Math.abs(node.position.x - finalX) < 60
      && Math.abs(node.position.y - finalY) < 60) && attempts < 100) {
      finalX += 50;
      finalY += 50;
      attempts++;
    }
    const newNode: Node = {
      id,
      type: "globalChatNode",
      position: { x: finalX, y: finalY },
      data: {
        id,
        name: "Task Auditor",
        status: "idle",
        summary: "",
        width: 384,
        height: 220,
        skillId: GLOBAL_CHAT_DEFAULT_SKILL_ID,
      },
    };
    return updateContextAndSync(state, targetTabId, (current) => ({
      nodes: [...current.nodes, newNode],
    }), true);
  }),
  addMcpNode: (x, y, tabId) => set((state) => {
    const targetTabId = tabId || getActiveCanvasTabId(state);
    const id = `mcp_${Date.now()}`;
    const context = getOrCreateContext(state, targetTabId);
    let finalX = x;
    let finalY = y;
    let attempts = 0;
    while (context.nodes.some((node) => Math.abs(node.position.x - finalX) < 60
      && Math.abs(node.position.y - finalY) < 60) && attempts < 100) {
      finalX += 50;
      finalY += 50;
      attempts++;
    }
    const newNode: Node = {
      id,
      type: "mcpNode",
      position: { x: finalX, y: finalY },
      data: { id, name: "MCP Context", mcpServerName: "", description: "" },
    };
    return updateContextAndSync(state, targetTabId, (current) => ({
      nodes: [...current.nodes, newNode],
    }), true);
  }),
  addStickyNode: (x, y, tabId, color) => set((state) => {
    const targetTabId = tabId || getActiveCanvasTabId(state);
    const id = `sticky_${Date.now()}`;
    const context = getOrCreateContext(state, targetTabId);
    const lastStickyColor = color || context.lastStickyColor || "yellow";
    let finalX = x;
    let finalY = y;
    let attempts = 0;
    while (context.nodes.some((node) => Math.abs(node.position.x - finalX) < 60
      && Math.abs(node.position.y - finalY) < 60) && attempts < 100) {
      finalX += 50;
      finalY += 50;
      attempts++;
    }
    const newNode: Node = {
      id,
      type: "stickyNode",
      position: { x: finalX, y: finalY },
      data: { id, color: lastStickyColor, content: "", width: 200, height: 150 },
    };
    return updateContextAndSync(state, targetTabId, (current) => ({
      nodes: [...current.nodes, newNode],
      lastStickyColor,
    }), true);
  }),
  addBoundaryNode: (x, y, tabId) => set((state) => {
    const targetTabId = tabId || getActiveCanvasTabId(state);
    const id = `boundary_${Date.now()}`;
    const newNode: Node = {
      id,
      type: "boundaryNode",
      position: { x, y },
      selectable: false,
      draggable: false,
      zIndex: 0,
      data: { id, name: "Boundary", width: 300, height: 200, fontSize: 12 },
    };
    return updateContextAndSync(state, targetTabId, (context) => ({
      nodes: [...context.nodes, newNode],
    }), true);
  }),
  updateTaskNode: (id, data) => set((state) => {
    const tabId = findTabIdByNodeId(state, id);
    return updateContextAndSync(state, tabId, (context) => ({
      nodes: context.nodes.map((node) => node.id === id
        ? { ...node, data: { ...node.data, ...data } }
        : node),
      isPipelineApplied: context.isPipelineApplied,
    }));
  }),
  updateNodePosition: (id, x, y) => set((state) => {
    const tabId = findTabIdByNodeId(state, id);
    return updateContextAndSync(state, tabId, (context) => ({
      nodes: context.nodes.map((node) => node.id === id ? { ...node, position: { x, y } } : node),
      isPipelineApplied: context.isPipelineApplied,
    }));
  }),
  deleteNode: (id) => set((state) => {
    const tabId = findTabIdByNodeId(state, id);
    const updates = updateContextAndSync(state, tabId, (context) => {
      if (context.nodes.find((node) => node.id === id)?.type === "taskNode") {
        VfsRegistry.getOrCreate(tabId).deleteNodeFiles(id).catch((error) => {
          console.error(`[store] Failed to delete VFS files for node ${id}:`, error);
        });
      }
      const nodeLogs = { ...context.nodeLogs };
      const nodeStatus = { ...context.nodeStatus };
      delete nodeLogs[id];
      delete nodeStatus[id];
      return {
        nodes: context.nodes.filter((node) => node.id !== id),
        edges: context.edges.filter((edge) => edge.source !== id && edge.target !== id),
        nodeLogs,
        nodeStatus,
      };
    }, true);
    return {
      ...updates,
      selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
    };
  }),
  addAndConnectContextNode: (x, y, taskId, taskHandleId, tabId) => set((state) => {
    const targetTabId = tabId || findTabIdByNodeId(state, taskId);
    const contextNodeId = `context_${Date.now()}`;
    const contextNode: Node = {
      id: contextNodeId,
      type: "contextNode",
      position: { x: x - 100, y: y - 50 },
      data: {
        id: contextNodeId,
        name: "",
        description: "",
        path: "",
        fileName: "",
        isDir: false,
      },
    };
    const edge: Edge = {
      id: `edge_${Date.now()}`,
      source: contextNodeId,
      sourceHandle: taskHandleId === "context-in-top" ? "context-out-bottom" : "context-out-top",
      target: taskId,
      targetHandle: taskHandleId,
      style: { stroke: "var(--color-status-success-solid)", strokeWidth: 2 },
    };
    return updateContextAndSync(state, targetTabId, (context) => ({
      nodes: [...context.nodes, contextNode],
      edges: [...context.edges, edge],
    }), true);
  }),
});
