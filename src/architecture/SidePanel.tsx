import { Callout } from "../components/ui";
import type { ArchitectureClient } from "./client";
import { FileInspector } from "./FileInspector";
import { FindingsPanel } from "./FindingsPanel";
import { GroupInspector } from "./GroupInspector";
import { NotesPanel } from "./NotesPanel";
import { parseNodeKey, type NodeKey } from "./identity";
import type { NavigationTarget } from "./navigation";
import type { FindingBadges, GroupGraph, GroupSummary } from "./model";
import type { Note } from "./persistence";
import type { SidePanel as PanelId } from "./viewState";
import styles from "./Architecture.module.css";

const TABS: { id: PanelId; label: string }[] = [
  { id: "inspector", label: "Inspector" },
  { id: "findings", label: "Findings" },
  { id: "notes", label: "Notes" },
];

export interface SidePanelProps {
  root: string;
  client: ArchitectureClient;
  revision: number;
  panel: PanelId;
  onPanel(panel: PanelId): void;
  selection: NodeKey | null;
  groups: ReadonlyMap<string, GroupSummary>;
  badges: FindingBadges | null;
  drill: GroupGraph | null;
  hasGit: boolean;
  hasFrameworks?: boolean;
  notes: Note[];
  orphaned: Note[];
  onOpenGroup(groupId: string): void;
  onNavigate(target: NavigationTarget): void;
  onAddNote(node: NodeKey, text: string): void;
  onEditNote(id: string, text: string): void;
  onDeleteNote(id: string): void;
}

function Inspector(props: SidePanelProps) {
  const parsed = props.selection ? parseNodeKey(props.selection) : null;
  if (!parsed) return <p className={styles.muted}>Select a node to see why it is here, what it imports, and what is known about it. Double-click a group to open its files.</p>;
  if (parsed.type === "group") {
    const group = props.groups.get(parsed.id);
    if (!group) return <Callout variant="info">This group is not part of the current view.</Callout>;
    return <GroupInspector group={group} badges={props.badges?.by_group[group.id] ?? null} boundary={props.drill?.group.id === group.id ? props.drill.boundary : null} onOpen={props.onOpenGroup} />;
  }
  return <FileInspector root={props.root} client={props.client} file={parsed.id} revision={props.revision} hasGit={props.hasGit} hasFrameworks={props.hasFrameworks} onNavigate={props.onNavigate} />;
}

export function SidePanel(props: SidePanelProps) {
  return (
    <aside className={styles.side} aria-label="Details">
      <div className={styles.tabs} role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={props.panel === tab.id}
            className={`${styles.tab} ${props.panel === tab.id ? styles.tabActive : ""}`}
            onClick={() => props.onPanel(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className={styles.panel} role="tabpanel">
        {props.panel === "inspector" ? <Inspector {...props} /> : null}
        {props.panel === "findings" ? <FindingsPanel root={props.root} client={props.client} revision={props.revision} onNavigate={props.onNavigate} /> : null}
        {props.panel === "notes" ? (
          <NotesPanel selection={props.selection} notes={props.notes} orphaned={props.orphaned} onAdd={props.onAddNote} onEdit={props.onEditNote} onDelete={props.onDeleteNote} />
        ) : null}
      </div>
    </aside>
  );
}
