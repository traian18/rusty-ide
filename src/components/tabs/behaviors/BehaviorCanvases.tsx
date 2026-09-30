/**
 * The two React Flow surfaces of the Behaviors tab. Both are controlled by
 * the documents: nodes are derived from them, drags are local until the drop
 * and then committed as `metadata.editor.position`.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowDownToLine, ArrowUpFromLine, Bot, ShieldCheck } from "lucide-react";
import { Button } from "../../ui";
import type { WorkflowStepProgress } from "../../../harness/core/workflowRun";
import { behaviorNodeTypes, type ProfileNodeData, type StepNodeData } from "./BehaviorNodes";
import {
  type Issue,
  type JsonObject,
  type Position,
  type StepType,
  edgesOf,
  gridPosition,
  isBuiltin,
  layoutSteps,
  positionOf,
  profileId,
  stepIssues,
  stepProfile,
  stepsOf,
  switchEdges,
} from "./behaviorModel";
import styles from "./Behaviors.module.css";

/** Local node state that follows `derived`, so drags render smoothly. */
function useFollowingNodes<T extends Node>(derived: T[]) {
  const [nodes, setNodes] = useState<T[]>(derived);
  useEffect(() => setNodes(derived), [derived]);
  const onNodesChange = useCallback(
    (changes: NodeChange<T>[]) =>
      setNodes((current) =>
        // Removal and selection belong to the documents and the inspector.
        applyNodeChanges(
          changes.filter((change) => change.type === "position" || change.type === "dimensions"),
          current,
        ),
      ),
    [],
  );
  return { nodes, onNodesChange };
}

const edgeStyle = { stroke: "var(--color-primary)", strokeWidth: 2 };
const failureStyle = { stroke: "var(--color-status-danger)", strokeWidth: 2, strokeDasharray: "6 4" };
const labelStyle = { fill: "var(--color-fg-default)", fontSize: 11 };
const labelBgStyle = { fill: "var(--color-surface-elevated)" };

/* ------------------------------------------------------------------ */
/*  Profiles                                                           */
/* ------------------------------------------------------------------ */

export interface ProfileCanvasProps {
  profiles: JsonObject[];
  builtins: JsonObject[];
  builtinPositions: Record<string, Position>;
  selected?: string;
  defaultProfile?: string;
  dirty: Set<string>;
  issues: Record<string, Issue[]>;
  onSelect: (id: string, ruleIndex?: number) => void;
  onMove: (id: string, position: Position) => void;
  onConnect: (source: string, target: string) => void;
}

export const ProfileCanvas: React.FC<ProfileCanvasProps> = (props) => (
  <ReactFlowProvider>
    <ProfileCanvasInner {...props} />
  </ReactFlowProvider>
);

const ProfileCanvasInner: React.FC<ProfileCanvasProps> = ({
  profiles,
  builtins,
  builtinPositions,
  selected,
  defaultProfile,
  dirty,
  issues,
  onSelect,
  onMove,
  onConnect,
}) => {
  const derived = useMemo(() => {
    const all = [...profiles, ...builtins];
    return all.map((profile, index): Node<ProfileNodeData, "profile"> => {
      const id = profileId(profile);
      const readOnly = isBuiltin(id);
      return {
        id,
        type: "profile",
        position: (readOnly ? builtinPositions[id] : positionOf(profile)) ?? gridPosition(index),
        data: {
          profile,
          selected: id === selected,
          readOnly,
          isDefault: defaultProfile ? id === defaultProfile : readOnly,
          issueCount: (issues[id] ?? []).filter((issue) => issue.blocking).length,
          dirty: dirty.has(id),
        },
      };
    });
  }, [profiles, builtins, builtinPositions, selected, defaultProfile, dirty, issues]);
  const { nodes, onNodesChange } = useFollowingNodes(derived);

  const edges = useMemo(
    () =>
      switchEdges([...profiles, ...builtins]).map(
        (edge): Edge => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          label: edge.label,
          data: { ruleIndex: edge.ruleIndex },
          style: edgeStyle,
          labelStyle,
          labelBgStyle,
          markerEnd: { type: MarkerType.ArrowClosed, color: "var(--color-primary)" },
        }),
      ),
    [profiles, builtins],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={behaviorNodeTypes}
      onNodesChange={onNodesChange}
      onNodeClick={(_, node) => onSelect(node.id)}
      onNodeDragStop={(_, node) => onMove(node.id, node.position)}
      onEdgeClick={(_, edge) => onSelect(edge.source, (edge.data as { ruleIndex: number }).ruleIndex)}
      onConnect={(connection: Connection) => {
        if (connection.source && connection.target && connection.source !== connection.target) {
          onConnect(connection.source, connection.target);
        }
      }}
      deleteKeyCode={null}
      fitView
      fitViewOptions={{ maxZoom: 1 }}
      minZoom={0.2}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
};

/* ------------------------------------------------------------------ */
/*  Workflows                                                          */
/* ------------------------------------------------------------------ */

export interface WorkflowCanvasProps {
  workflow: JsonObject;
  selectedStep?: string;
  selectedEdge?: string;
  issues: Issue[];
  /** Step progress of the workflow's latest run. */
  runSteps?: Record<string, WorkflowStepProgress>;
  onSelectStep: (id: string) => void;
  onSelectEdge: (id: string) => void;
  onSelectNone: () => void;
  onMove: (id: string, position: Position) => void;
  onConnect: (source: string, target: string) => void;
  onAddStep: (type: StepType, position: Position) => void;
  onDrill: (stepId: string, profileId: string | undefined) => void;
}

export const WorkflowCanvas: React.FC<WorkflowCanvasProps> = (props) => (
  <ReactFlowProvider>
    <WorkflowCanvasInner {...props} />
  </ReactFlowProvider>
);

const PALETTE: { type: StepType; label: string; Icon: typeof Bot }[] = [
  { type: "input", label: "Input", Icon: ArrowDownToLine },
  { type: "agent", label: "Agent", Icon: Bot },
  { type: "verify", label: "Verify", Icon: ShieldCheck },
  { type: "output", label: "Output", Icon: ArrowUpFromLine },
];

const WorkflowCanvasInner: React.FC<WorkflowCanvasProps> = ({
  workflow,
  selectedStep,
  selectedEdge,
  issues,
  runSteps,
  onSelectStep,
  onSelectEdge,
  onSelectNone,
  onMove,
  onConnect,
  onAddStep,
  onDrill,
}) => {
  const derived = useMemo(() => {
    const positions = layoutSteps(workflow);
    return stepsOf(workflow).map((step, index): Node<StepNodeData, "step"> => {
      const id = String(step.id);
      return {
        id,
        type: "step",
        position: positions.get(id) ?? gridPosition(index, 4),
        data: {
          step,
          selected: id === selectedStep,
          issueCount: stepIssues(issues, index, id).filter((issue) => issue.blocking).length,
          run: runSteps?.[id],
          onDrill: step.type === "agent" ? (profile) => onDrill(id, profile) : undefined,
        },
      };
    });
  }, [workflow, selectedStep, issues, runSteps, onDrill]);
  const { nodes, onNodesChange } = useFollowingNodes(derived);

  const edges = useMemo(
    () =>
      edgesOf(workflow).map((edge): Edge => {
        const failure = edge.condition === "on_failure";
        const color = failure ? "var(--color-status-danger)" : "var(--color-primary)";
        return {
          id: String(edge.id),
          source: String(edge.source),
          target: String(edge.target),
          label: failure ? "on failure" : undefined,
          selected: edge.id === selectedEdge,
          style: failure ? failureStyle : edgeStyle,
          labelStyle,
          labelBgStyle,
          markerEnd: { type: MarkerType.ArrowClosed, color },
        };
      }),
    [workflow, selectedEdge],
  );

  // Verify steps with a retry target draw a dotted loop back to it.
  const retryEdges = useMemo(
    () =>
      stepsOf(workflow).flatMap((step): Edge[] => {
        const config = step.config as JsonObject | undefined;
        const target = config && typeof config.retry_target === "string" ? config.retry_target : undefined;
        if (step.type !== "verify" || !target) return [];
        return [
          {
            id: `retry:${String(step.id)}`,
            source: String(step.id),
            target,
            label: "retry",
            type: "smoothstep",
            selectable: false,
            style: { stroke: "var(--color-status-warning)", strokeWidth: 1.5, strokeDasharray: "2 4" },
            labelStyle,
            labelBgStyle,
          },
        ];
      }),
    [workflow],
  );

  const nextPosition = (): Position => {
    const placed = stepsOf(workflow).map((step) => positionOf(step)).filter(Boolean) as Position[];
    const right = placed.reduce((max, position) => Math.max(max, position.x), 0);
    return { x: right + 320, y: 80 };
  };

  return (
    <>
      <div className={styles.palette}>
        {PALETTE.map(({ type, label, Icon }) => (
          <Button key={type} type="button" icon={<Icon size={14} />} onClick={() => onAddStep(type, nextPosition())}>
            {label}
          </Button>
        ))}
      </div>
      <ReactFlow
        nodes={nodes}
        edges={[...edges, ...retryEdges]}
        nodeTypes={behaviorNodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_, node) => onSelectStep(node.id)}
        onNodeDoubleClick={(_, node) => {
          const step = stepsOf(workflow).find((candidate) => candidate.id === node.id);
          if (step?.type === "agent") onDrill(node.id, stepProfile(step));
        }}
        onNodeDragStop={(_, node) => onMove(node.id, node.position)}
        onEdgeClick={(_, edge) => {
          if (!edge.id.startsWith("retry:")) onSelectEdge(edge.id);
        }}
        onPaneClick={onSelectNone}
        onConnect={(connection: Connection) => {
          if (connection.source && connection.target && connection.source !== connection.target) {
            onConnect(connection.source, connection.target);
          }
        }}
        deleteKeyCode={null}
        fitView
        fitViewOptions={{ maxZoom: 1 }}
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </>
  );
};
