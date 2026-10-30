import React, { useMemo } from "react";
import { Background, BackgroundVariant, Controls, MarkerType, ReactFlow, ReactFlowProvider, type Connection, type Edge, type Node } from "@xyflow/react";
import { behaviorNodeTypes, type ProfileNodeData } from "./BehaviorNodes";
import { type Issue, type JsonObject, type Position, gridPosition, isBuiltin, separateOverlaps, positionOf, profileId, switchEdges } from "../model";
import { edgeStyle, labelStyle, labelBgStyle } from "./canvasStyles";
import { useFollowingNodes } from "./useFollowingNodes";

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
    // Where each profile asks to be; one that would hide another is moved to a free spot.
    const wanted = all.map((profile, index): [string, Position] => {
      const id = profileId(profile);
      return [id, (isBuiltin(id) ? builtinPositions[id] : positionOf(profile)) ?? gridPosition(index)];
    });
    const placed = separateOverlaps(wanted);
    return all.map((profile): Node<ProfileNodeData, "profile"> => {
      const id = profileId(profile);
      const readOnly = isBuiltin(id);
      return {
        id,
        type: "profile",
        position: placed.get(id)!,
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
