import { createContext, memo, useContext, useMemo, type CSSProperties } from "react";
import { Handle, Position, useStore, type Node, type NodeProps } from "@xyflow/react";
import { FileCode2, Folder, NotebookPen, Package, RefreshCcw, Layers } from "lucide-react";
import { SeverityPill } from "./SeverityPill";
import { totalFindings, type CanvasNode } from "./graphModel";
import { packDots } from "./dots";
import type { LevelChild } from "./model";
import { detailFor } from "./zoom";
import styles from "./Architecture.module.css";

export type ArchitectureNodeData = CanvasNode & { selected: boolean };
/** xyflow gives its built-in `group` type a box style, so ours use their own type names. */
export type FlowNodeType = "arch-group" | "arch-file" | "arch-frame";
export const flowType = (type: ArchitectureNodeData["type"]): FlowNodeType => `arch-${type}`;
export type ArchitectureFlowNode = Node<ArchitectureNodeData, FlowNodeType>;

const TONE_CLASS = ["tone0", "tone1", "tone2", "tone3"] as const;
const SEVERITY_CLASS = ["toneHigh", "toneMedium", "toneLow", "toneInfo"] as const;

/** Tones 0-3 are the palette; 10-13 the severities; anything else is neutral. */
const toneClass = (tone: number | undefined) =>
  tone === undefined || tone < 0 ? "" : tone >= 10 ? (styles[SEVERITY_CLASS[tone - 10]] ?? "") : styles[TONE_CLASS[tone % TONE_CLASS.length]];

/** Opens one of the small circles inside a bubble; provided by the canvas. */
export const OpenChildContext = createContext<(child: LevelChild) => void>(() => undefined);

/** The components of a node as small circles inside it. Clicking one opens it without opening the node. */
function ChildDots({ children, more, diameter, zoom }: { children: LevelChild[]; more: number; diameter: number; zoom: number }) {
  const open = useContext(OpenChildContext);
  const radius = diameter / 2 - 2;
  const dots = useMemo(() => packDots(children.map((child) => child.file_count), radius), [children, radius]);
  const nameDots = zoom >= 1;
  return (
    <>
      {children.map((child, index) => {
        const dot = dots[index];
        if (!dot) return null;
        return (
          <button
            key={child.id}
            type="button"
            className={`${styles.childDot} ${child.has_children ? styles.childDotParent : ""}`}
            style={{ width: dot.r * 2, height: dot.r * 2, left: radius + dot.x - dot.r, top: radius + dot.y - dot.r }}
            title={`${child.label} · ${child.file_count} file${child.file_count === 1 ? "" : "s"}${child.has_children ? " · has components" : ""}`}
            aria-label={`Open ${child.label}, ${child.file_count} files`}
            onClick={(event) => {
              event.stopPropagation();
              open(child);
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            {nameDots && dot.r >= 14 ? <span className={styles.childDotName}>{child.label.split("/").pop()}</span> : null}
          </button>
        );
      })}
      {more > 0 && zoom >= 0.55 ? <span className={styles.childMore}>+{more}</span> : null}
    </>
  );
}

/** A circle sized by file count. Zoomed out it is just the circle (and a name for the largest); zoomed in it explains itself. */
export function Bubble({ data, zoom }: { data: ArchitectureNodeData; zoom: number }) {
  const detail = detailFor(zoom);
  const total = totalFindings(data.badges);
  const diameter = data.diameter ?? 64;
  const named = detail !== "far" || data.major || data.selected;
  const files = data.fileCount ?? 0;
  const circle = [
    styles.bubble,
    data.selected ? styles.nodeSelected : "",
    data.inCycle ? styles.nodeCycle : "",
    data.fold || data.synthetic ? styles.nodeFold : "",
    data.basis === "inferred" ? styles.nodeInferred : "",
  ].join(" ");
  return (
    <div
      className={styles.bubbleBox}
      style={{ width: data.width ?? diameter, height: data.height ?? diameter }}
      title={`${data.label} · ${files} file${files === 1 ? "" : "s"}`}
      role="group"
      aria-label={`${data.type} ${data.label}, ${files} files${total ? `, ${total} findings` : ""}${data.inCycle ? ", in an import cycle" : ""}`}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} className={styles.handle} style={{ top: diameter / 2, left: "50%" }} />
      <div className={circle} style={{ width: diameter, height: diameter, ...(data.color ? ({ "--tone": data.color } as CSSProperties) : {}) }}>
        {data.children?.length ? <ChildDots children={data.children} more={data.moreChildren ?? 0} diameter={diameter} zoom={zoom} /> : null}
        {detail !== "far" && data.worst ? (
          <span className={styles.bubbleBadge}>
            <SeverityPill severity={data.worst} count={total} />
          </span>
        ) : null}
        {detail === "near" ? (
          <span className={styles.bubbleIcons}>
            {data.inCycle ? <RefreshCcw size={12} aria-label="In an import cycle" className={styles.cycleIcon} /> : null}
            {data.hasNote ? <NotebookPen size={12} aria-label="Has a note" /> : null}
          </span>
        ) : null}
      </div>
      {named ? (
        // Zoomed out the label grows against the zoom, so the largest names stay readable.
        <div className={styles.bubbleLabel} style={{ fontSize: detail === "near" ? undefined : Math.min(30, Math.max(12, 13 / Math.max(zoom, 0.05))) }}>
          <span className={styles.bubbleName}>{data.label}</span>
          {detail !== "far" ? <span className={styles.bubbleCount}> {files}</span> : null}
        </div>
      ) : null}
      {detail === "near" && data.detail ? <div className={styles.bubbleDetail}>{data.detail}</div> : null}
      <Handle type="source" position={Position.Top} isConnectable={false} className={styles.handle} style={{ top: diameter / 2, left: "50%" }} />
    </div>
  );
}

function BubbleNode({ data }: { data: ArchitectureNodeData }) {
  const zoom = useStore((state) => state.transform[2]);
  return <Bubble data={data} zoom={zoom} />;
}

function NodeCard({ data }: { data: ArchitectureNodeData }) {
  if (data.bubble) return <BubbleNode data={data} />;
  const total = totalFindings(data.badges);
  const Icon = data.fold ? Layers : data.type === "file" ? FileCode2 : data.container || data.synthetic ? Folder : Package;
  const tone = toneClass(data.tone);
  const className = [
    styles.node,
    tone,
    data.selected ? styles.nodeSelected : "",
    data.basis === "inferred" ? styles.nodeInferred : "",
    data.container ? styles.nodeContainer : "",
    data.fold ? styles.nodeFold : "",
    data.inCycle ? styles.nodeCycle : "",
  ].join(" ");
  const sized = data.width && !data.container ? { width: data.width, minHeight: data.height ?? undefined } : data.width ? { width: data.width, height: data.height ?? undefined } : undefined;
  return (
    <div className={className} style={sized} role="group" aria-label={`${data.type} ${data.label}${total ? `, ${total} findings` : ""}${data.inCycle ? ", in an import cycle" : ""}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} className={styles.handle} />
      <div className={styles.nodeHeader}>
        <span className={styles.nodeLabel} title={data.label}>
          <Icon size={12} aria-hidden /> {data.label}
        </span>
        <span className={styles.toolbarGroup}>
          {data.inCycle ? <RefreshCcw size={12} aria-label="In an import cycle" className={styles.cycleIcon} /> : null}
          {data.hasNote ? <NotebookPen size={12} aria-label="Has a note" /> : null}
          {data.worst ? <SeverityPill severity={data.worst} count={total} /> : null}
        </span>
      </div>
      <div className={styles.nodeSubtitle} title={data.subtitle}>
        {data.subtitle}
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} className={styles.handle} />
    </div>
  );
}

function FrameNode({ data }: NodeProps<ArchitectureFlowNode>) {
  return (
    <div className={styles.frame} style={{ width: data.width ?? undefined, height: data.height ?? undefined }} aria-label={`Workspace ${data.label}`} role="group">
      <span className={styles.frameLabel}>{data.label}</span>
    </div>
  );
}

const GroupNode = memo(({ data }: NodeProps<ArchitectureFlowNode>) => <NodeCard data={data} />);
const FileNode = memo(({ data }: NodeProps<ArchitectureFlowNode>) => <NodeCard data={data} />);
GroupNode.displayName = "GroupNode";
FileNode.displayName = "FileNode";

export const architectureNodeTypes = { "arch-group": GroupNode, "arch-file": FileNode, "arch-frame": FrameNode };
