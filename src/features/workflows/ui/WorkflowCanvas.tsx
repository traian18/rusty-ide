import React, { useMemo } from "react";
import { Background, BackgroundVariant, Controls, MarkerType, ReactFlow, ReactFlowProvider, type Connection, type Edge, type Node } from "@xyflow/react";
import { ArrowDownToLine, ArrowUpFromLine, Bot, ShieldCheck, Split, UserCheck } from "lucide-react";
import { Button } from "../../../lib/ui";
import type { WorkflowStepProgress } from "../../../harness/core/workflowRun";
import { behaviorNodeTypes, type StepNodeData } from "./BehaviorNodes";
import { behaviorEdgeTypes, type LoopFlowEdge } from "./LoopEdge";
import { type Issue, type JsonObject, type Position, type StepType, approvalReviseTarget, edgesOf, gridPosition, layoutSteps, loopLanes, separateOverlaps, spreadColumns, positionOf, stepIssues, stepProfile, stepsOf } from "../model";
import styles from "./Behaviors.module.css";
import { edgeStyle, failureStyle, labelStyle, labelBgStyle } from "./canvasStyles";
import { useFollowingNodes } from "./useFollowingNodes";

export interface WorkflowCanvasProps {
  workflow: JsonObject;
  readOnly?: boolean;
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
  { type: "approval", label: "Approval", Icon: UserCheck },
  { type: "subflow", label: "Subflow", Icon: Split },
  { type: "output", label: "Output", Icon: ArrowUpFromLine },
];

const WorkflowCanvasInner: React.FC<WorkflowCanvasProps> = ({
  readOnly = false,
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
    const stored = layoutSteps(workflow);
    const steps = stepsOf(workflow);
    // Room for every edge to be seen, and no step on top of another.
    const spread = spreadColumns(stored, edgesOf(workflow));
    const positions = separateOverlaps(steps.map((step, index): [string, Position] => [String(step.id), spread.get(String(step.id)) ?? gridPosition(index, 4)]));
    return steps.map((step, index): Node<StepNodeData, "step"> => {
      const id = String(step.id);
      return {
        id,
        type: "step",
        position: positions.get(id)!,
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

  // Verify steps with a retry target, and approval steps (where requested
  // changes go), draw a dotted loop back to that step, below the cards.
  const retryEdges = useMemo(() => {
    const loops = stepsOf(workflow).flatMap((step) => {
      const config = step.config as JsonObject | undefined;
      const approval = step.type === "approval";
      const target = approval
        ? approvalReviseTarget(step)
        : config && typeof config.retry_target === "string" ? config.retry_target : undefined;
      if ((step.type !== "verify" && !approval) || !target) return [];
      return [{ id: `retry:${String(step.id)}`, source: String(step.id), target, approval }];
    });
    const x = new Map(derived.map((node) => [node.id, node.position.x]));
    const lanes = loopLanes(
      loops.map(({ id, source, target }) => {
        const [from, to] = [x.get(source) ?? 0, x.get(target) ?? 0];
        return { id, left: Math.min(from, to), right: Math.max(from, to) };
      }),
    );
    return loops.map(({ id, source, target, approval }): LoopFlowEdge => ({
      id,
      source,
      target,
      label: approval ? "changes" : "retry",
      type: "loop",
      data: { lane: lanes.get(id) ?? 0 },
      selectable: false,
      style: { stroke: "var(--color-status-warning)", strokeWidth: 1.5, strokeDasharray: "2 4" },
      markerEnd: { type: MarkerType.ArrowClosed, color: "var(--color-status-warning)" },
      labelStyle,
      labelBgStyle,
    }));
  }, [workflow, derived]);

  const nextPosition = (): Position => {
    const placed = stepsOf(workflow).map((step) => positionOf(step)).filter(Boolean) as Position[];
    const right = placed.reduce((max, position) => Math.max(max, position.x), 0);
    return { x: right + 320, y: 80 };
  };

  return (
    <>
      <div className={styles.palette}>
        {PALETTE.map(({ type, label, Icon }) => (
          <Button key={type} type="button" disabled={readOnly} icon={<Icon size={14} />} onClick={() => onAddStep(type, nextPosition())}>
            {label}
          </Button>
        ))}
      </div>
      <ReactFlow
        nodes={nodes}
        edges={[...edges, ...retryEdges]}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        nodeTypes={behaviorNodeTypes}
        edgeTypes={behaviorEdgeTypes}
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
