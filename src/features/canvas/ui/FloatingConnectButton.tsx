import { getNodeCenterLocal } from "./canvasEffects";
import { useViewport } from "@xyflow/react";
import { Link2 } from "lucide-react";

/**
 * A floating button that appears between two selected nodes, allowing
 * the user to create a connection with a single click.
 *
 * Uses `useViewport` to position itself accurately in screen space.
 */
export const FloatingConnectButton: React.FC<{
  nodeA: any;
  nodeB: any;
  onConnect: () => void;
}> = ({ nodeA, nodeB, onConnect }) => {
  const { x: viewportX, y: viewportY, zoom } = useViewport();

  const centerA = getNodeCenterLocal(nodeA);
  const centerB = getNodeCenterLocal(nodeB);
  const midX = (centerA.x + centerB.x) / 2;
  const midY = (centerA.y + centerB.y) / 2;

  const left = midX * zoom + viewportX;
  const top = midY * zoom + viewportY;

  return (
    <button
      onClick={onConnect}
      style={{
        position: "absolute",
        left: `${left}px`,
        top: `${top}px`,
        transform: "translate(-50%, -50%)",
        zIndex: 1000,
      }}
      className="bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/90 text-[var(--color-primary-foreground)] rounded-full p-3 shadow-2xl border border-[var(--border-color)] cursor-pointer flex items-center justify-center transition-all hover:scale-110 active:scale-95 duration-200"
      title="Connect nodes"
    >
      <Link2 size={18} />
    </button>
  );
};
