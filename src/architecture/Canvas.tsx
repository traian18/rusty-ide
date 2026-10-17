import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyNodeChanges, Background, BackgroundVariant, Controls, MarkerType, MiniMap, ReactFlow,
  type Edge, type NodeChange, type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { parseNodeKey, type NodeKey } from "./identity";
import type { CanvasGraph } from "./graphModel";
import { architectureEdgeTypes } from "./edges";
import type { LevelChild } from "./model";
import { architectureNodeTypes, flowType, OpenChildContext, type ArchitectureFlowNode } from "./nodes";
import type { Point } from "./layout";
import type { SavedViewport } from "./viewState";
import styles from "./Architecture.module.css";

export interface CanvasProps {
  graph: CanvasGraph;
  selection: NodeKey | null;
  onSelect(key: NodeKey | null): void;
  /** Double-clicking a group node opens its files. */
  onOpenGroup(groupId: string): void;
  /** Clicking one of the small circles inside a bubble opens that component. */
  onOpenChild?(child: LevelChild): void;
  /** Pan and zoom to come back to, when the view was left and is shown again. */
  viewport?: SavedViewport;
  onViewport(viewKey: string, viewport: SavedViewport): void;
  /** Only positions change when a node is dragged; the relationships are never edited. */
  onMoved(viewKey: string, positions: Record<string, Point>): void;
}

const toNodes = (graph: CanvasGraph, selection: NodeKey | null): ArchitectureFlowNode[] =>
  graph.nodes.map((node) => ({
    id: node.id,
    type: flowType(node.type),
    position: node.position,
    data: { ...node, selected: node.id === selection },
    connectable: false,
    deletable: false,
    ...(node.parentId ? { parentId: node.parentId, extent: "parent" as const } : {}),
    ...(node.type === "frame" ? { selectable: false, draggable: false, zIndex: -1 } : {}),
    ...(node.container && node.width ? { style: { width: node.width, height: node.height ?? undefined }, zIndex: -1 } : {}),
  }));

const toEdges = (graph: CanvasGraph, selection: NodeKey | null): Edge[] =>
  graph.edges.map((edge) => {
    const emphasised = edge.inCycle || edge.source === selection || edge.target === selection;
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label || (selection && (edge.source === selection || edge.target === selection) ? edge.selectedLabel : undefined),
      // Wide arcs run centre to centre under the bubbles, coloured by where they come from; thin file edges keep arrows.
      ...(edge.framework
        ? { type: "default", markerEnd: { type: MarkerType.ArrowClosed } }
        : edge.thickness
        ? { type: "arch-band", data: { from: edge.fromColor ?? "", to: edge.toColor ?? "", cycle: edge.inCycle === true } }
        : { markerEnd: { type: MarkerType.ArrowClosed } }),
      style: {
        ...(edge.framework ? { strokeDasharray: "2 6", strokeLinecap: "round" as const, strokeWidth: 2.5, stroke: "var(--color-fg-muted)", strokeOpacity: emphasised ? 0.95 : 0.7 } : {}),
        ...(edge.typeOnly ? { strokeDasharray: "5 4" } : {}),
        ...(edge.thickness ? { strokeWidth: edge.thickness, strokeOpacity: emphasised ? 0.9 : 0.5, strokeLinecap: "round" as const } : {}),
      },
      focusable: false,
      deletable: false,
      selectable: false,
      reconnectable: false,
    };
  });

/** The minimap draws SVG fills, which cannot read CSS variables from props, so the theme's values are resolved once. */
function useMiniMapColors() {
  return useMemo(() => {
    const root = typeof document === "undefined" ? null : getComputedStyle(document.documentElement);
    const value = (name: string, fallback: string) => root?.getPropertyValue(name).trim() || fallback;
    return { node: value("--color-fg-muted", "gray"), mask: `color-mix(in srgb, ${value("--color-surface-canvas", "black")} 70%, transparent)` };
  }, []);
}

const noOpenChild = () => undefined;

/** The read-only canvas: nodes can be selected, opened, and moved; nothing else can change. */
export function Canvas({ graph, selection, onSelect, onOpenGroup, onOpenChild, viewport, onViewport, onMoved }: CanvasProps) {
  const [nodes, setNodes] = useState<ArchitectureFlowNode[]>(() => toNodes(graph, selection));
  useEffect(() => setNodes(toNodes(graph, selection)), [graph, selection]);
  const edges = useMemo(() => toEdges(graph, selection), [graph, selection]);
  const miniMapColors = useMiniMapColors();
  const flow = useRef<ReactFlowInstance<ArchitectureFlowNode> | null>(null);
  // A view that is shown again keeps the pan and zoom it was left with, until its nodes change.
  const restored = useRef(viewport !== undefined);

  // Fit again whenever a different set of nodes is shown. Nodes are measured a moment after they
  // mount, so the fit waits a frame and a beat; the first fit comes from `onInit`.
  const scheduleFit = () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => void flow.current?.fitView({ padding: 0.12, maxZoom: 1.2, duration: 200 }), 80);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
    };
  };
  const fitKey = `${graph.viewKey}:${graph.nodes.map((node) => node.id).join("|")}`;
  const firstKey = useRef(fitKey);
  useEffect(() => {
    // Still the nodes the saved viewport was made for: leave the view where it was.
    if (restored.current && fitKey === firstKey.current) return;
    restored.current = false;
    return scheduleFit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  return (
    <OpenChildContext.Provider value={onOpenChild ?? noOpenChild}>
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={architectureNodeTypes}
      edgeTypes={architectureEdgeTypes}
      onNodesChange={(changes: NodeChange<ArchitectureFlowNode>[]) => setNodes((current) => applyNodeChanges(changes, current))}
      onNodeClick={(_, node) => onSelect(node.id as NodeKey)}
      onNodeDoubleClick={(_, node) => {
        const parsed = parseNodeKey(node.id);
        if (parsed?.type === "group") onOpenGroup(parsed.id);
      }}
      onNodeDragStop={(_, node) => onMoved(graph.viewKey, { [node.id]: node.position })}
      onPaneClick={() => onSelect(null)}
      nodesDraggable
      nodesConnectable={false}
      edgesFocusable={false}
      elementsSelectable
      deleteKeyCode={null}
      onInit={(instance) => {
        flow.current = instance;
        if (!restored.current) scheduleFit();
      }}
      {...(viewport ? { defaultViewport: viewport } : { fitView: true })}
      fitViewOptions={{ padding: 0.12, maxZoom: 1.2 }}
      onMoveEnd={(_, next) => onViewport(graph.viewKey, { x: next.x, y: next.y, zoom: next.zoom })}
      minZoom={0.1}
      onlyRenderVisibleElements
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable className={styles.minimap} nodeColor={(node) => (node.type === "arch-frame" ? "transparent" : miniMapColors.node)} maskColor={miniMapColors.mask} />
    </ReactFlow>
    </OpenChildContext.Provider>
  );
}
