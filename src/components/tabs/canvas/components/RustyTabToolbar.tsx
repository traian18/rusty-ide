import React, { useEffect, useRef, useState } from "react";
import { CheckSquare, ChevronDown, Eye, EyeOff, Folder, Globe, Plus, Save, Square, StickyNote, Plug } from "lucide-react";
import type { Node, ReactFlowInstance } from "@xyflow/react";
import { focusCanvasNode } from "../../../../services/canvasNodeNavigation";
import { getCanvasCenter } from "../helpers/canvasHelpers";
import styles from "./RustyTabToolbar.module.css";

interface RustyTabToolbarProps {
  tabId: string; boundaryNodes: Node[]; globalChatNode: Node | undefined; hasGlobalChatNode: boolean; rfInstance: ReactFlowInstance | null; contextNodesHidden: boolean; onToggleContextNodesHidden: () => void;
  onAddTaskNode: (x: number, y: number) => void; onAddContextNode: (x: number, y: number) => void; onAddMcpNode: (x: number, y: number) => void; onAddStickyNode: (x: number, y: number) => void; onAddBoundaryNode: (x: number, y: number) => void; onAddGlobalChatNode: (x: number, y: number) => void; onSavePipeline: () => void;
  /** Legacy props accepted while the dormant reconciliation caller remains in source. */
  isReconciliationRunning?: boolean; isPipelineApplied?: boolean; onReconcileCode?: () => void; onApplyChanges?: () => void;
}
export const RustyTabToolbar: React.FC<RustyTabToolbarProps> = (props) => {
  const [boundariesOpen, setBoundariesOpen] = useState(false); const [nodesOpen, setNodesOpen] = useState(false); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const close = (event: MouseEvent) => { if (ref.current && event.target instanceof Node && !ref.current.contains(event.target)) { setBoundariesOpen(false); setNodesOpen(false); } }; window.addEventListener("click", close); return () => window.removeEventListener("click", close); }, []);
  const add = (action: (x: number, y: number) => void, x: number, y: number) => { const center = getCanvasCenter(props.rfInstance, props.tabId); action(center.x + x, center.y + y); setNodesOpen(false); };
  return <div ref={ref} className={styles.container}>
    <button id="jump-to-global-node-btn" type="button" onClick={() => props.globalChatNode && focusCanvasNode(props.tabId, props.globalChatNode.id)} disabled={!props.globalChatNode} className={styles.button}><Globe size={14} /><span>Jump to Global Node</span></button>
    <button id="toggle-context-nodes-btn" type="button" onClick={props.onToggleContextNodesHidden} className={styles.button}>{props.contextNodesHidden ? <EyeOff size={14} /> : <Eye size={14} />}<span>{props.contextNodesHidden ? "Hidden" : "Context"}</span></button>
    <div className={styles.relative}><button id="boundary-navigation-btn" type="button" onClick={() => props.boundaryNodes.length && setBoundariesOpen(!boundariesOpen)} disabled={!props.boundaryNodes.length} className={styles.button}><Square size={14} /><span>Boundaries</span><ChevronDown size={12} /></button>{boundariesOpen && <div className={styles.menu}>{props.boundaryNodes.map((node, index) => <button key={node.id} type="button" onClick={() => { focusCanvasNode(props.tabId, node.id); setBoundariesOpen(false); }} className={styles.menuItem}>{String(node.data?.name || `Boundary ${index + 1}`)}</button>)}</div>}</div>
    <div className={styles.relative}><button id="add-node-dropdown-btn" type="button" onClick={() => setNodesOpen(!nodesOpen)} className={styles.button}><Plus size={14} /><span>Add Node</span><ChevronDown size={12} /></button>{nodesOpen && <div className={styles.menu}><Item icon={<CheckSquare size={13} />} label="Create Task Node" onClick={() => add(props.onAddTaskNode, -75, -30)} /><Item icon={<Folder size={13} />} label="Create Context Node" onClick={() => add(props.onAddContextNode, -75, -30)} /><Item icon={<Plug size={13} />} label="Create MCP Node" onClick={() => add(props.onAddMcpNode, -75, -30)} /><Item icon={<StickyNote size={13} />} label="Create Sticky Note" onClick={() => add(props.onAddStickyNode, -100, -75)} /><Item icon={<Square size={13} />} label="Create Boundary" onClick={() => add(props.onAddBoundaryNode, -150, -100)} /><Item icon={<Globe size={13} />} label="Create Global Explorer" disabled={props.hasGlobalChatNode} onClick={() => add(props.onAddGlobalChatNode, -75, -30)} /></div>}</div>
    <button id="save-rusty-btn" type="button" onClick={props.onSavePipeline} className={styles.button}><Save size={14} /><span>Save Rusty</span></button>
  </div>;
};
const Item: React.FC<{ icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }> = ({ icon, label, onClick, disabled }) => <button type="button" onClick={onClick} disabled={disabled} className={styles.menuItem}>{icon}<span>{label}</span></button>;
