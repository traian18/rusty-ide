/** A stand-in for @xyflow/react in component tests: renders nodes and edges as buttons and spans. */
export const flowState = { lastProps: null as Record<string, any> | null, zoom: 1 };

export const flowStub = {
  ReactFlow: (props: Record<string, any>) => {
    flowState.lastProps = props;
    return (
      <div data-testid="flow">
        {props.nodes.map((node: any) => (
          <div key={node.id}>
            <button
              data-testid={`node:${node.id}`}
              data-x={node.position.x}
              data-y={node.position.y}
              data-parent={node.parentId ?? ""}
              onClick={(event) => props.onNodeClick?.(event, node)}
              onDoubleClick={(event) => props.onNodeDoubleClick?.(event, node)}
            >
              {node.data.label}
            </button>
          </div>
        ))}
        {props.edges.map((edge: any) => (
          <span key={edge.id} data-testid={`edge:${edge.id}`} data-width={edge.style?.strokeWidth ?? ""} data-cycle={edge.data?.cycle ? "yes" : ""} data-type={edge.type ?? ""} data-from={edge.data?.from ?? ""} data-to={edge.data?.to ?? ""}>
            {edge.label}
          </span>
        ))}
      </div>
    );
  },
  Handle: () => null,
  BaseEdge: () => null,
  Position: { Left: "left", Right: "right" },
  MarkerType: { ArrowClosed: "arrowclosed" },
  Background: () => null,
  BackgroundVariant: { Dots: "dots" },
  Controls: () => null,
  MiniMap: () => null,
  useStore: (selector: (state: { transform: number[] }) => unknown) => selector({ transform: [0, 0, flowState.zoom] }),
  applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes,
};
