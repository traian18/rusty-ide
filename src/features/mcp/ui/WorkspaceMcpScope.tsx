import React, { useState } from "react";
import { Copy, FolderOpen } from "lucide-react";
import { useWorkspaceStore } from "../../../store";
import { otherWorkspacesWithServers } from "../service/workspaceServers";
import { CustomSelect } from "../../../lib/ui/CustomSelect";

function folderName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).pop() || root;
}

/** Which workspace the servers below belong to, and copying servers in from another workspace. */
export const WorkspaceMcpScope: React.FC<{ rootPath: string }> = ({ rootPath }) => {
  const byWorkspace = useWorkspaceStore((state) => state.mcpServersByWorkspace);
  const copyMcpServersFrom = useWorkspaceStore((state) => state.copyMcpServersFrom);
  const [source, setSource] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const others = otherWorkspacesWithServers(byWorkspace, rootPath);

  const copy = () => {
    if (!source) return;
    const copied = copyMcpServersFrom(source);
    setNote(copied > 0
      ? `Copied ${copied} server${copied === 1 ? "" : "s"} from ${folderName(source)}.`
      : `This workspace already has every server ${folderName(source)} has.`);
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-y border-[var(--color-border-subtle)] py-2.5 text-[length:var(--font-size-ui-sm)] text-[var(--color-fg-muted)]">
      <FolderOpen size={14} className="flex-shrink-0" />
      <span className="min-w-0">
        Servers for <strong className="font-semibold text-[var(--color-fg-strong)]" title={rootPath}>{folderName(rootPath)}</strong>. Other workspaces keep their own.
      </span>
      {others.length > 0 && (
        <span className="ml-auto flex items-center gap-2">
          <CustomSelect
            id="mcp-copy-workspace-select"
            value={source}
            onChange={(value) => { setSource(value); setNote(null); }}
            options={others.map(({ root, count }) => ({ id: root, name: `${folderName(root)} (${count})` }))}
            placeholder="Copy from another workspace…"
            className="w-56"
          />
          <button
            type="button"
            onClick={copy}
            disabled={!source}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border-default)] px-2.5 py-1.5 font-semibold text-[var(--color-fg-default)] transition-colors hover:bg-[var(--color-interaction-hover)] hover:text-[var(--color-fg-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-border-focus)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Copy size={13} /> Copy
          </button>
        </span>
      )}
      {note && <span className="basis-full text-[var(--color-fg-muted)]" role="status">{note}</span>}
    </div>
  );
};
