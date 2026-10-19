import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { GitCompare } from "lucide-react";

interface CompareRevisionPickerProps {
  repoPath: string;
  /** The file being compared; its commit history populates the Commits tab. */
  filePath: string;
  /** Called with the chosen branch, tag, or commit hash. */
  onCompare: (revision: string) => void;
}

interface CommitInfo {
  hash: string;
  short_hash?: string;
  shortHash?: string;
  author: string;
  date: string;
  subject: string;
}

interface Branches {
  local: string[];
  remote: string[];
}

/**
 * "Compare with…" button + popover: pick a branch, or a commit that touched
 * this file. Selection only, so there is no free-text revision to mistype.
 */
export const CompareRevisionPicker: React.FC<CompareRevisionPickerProps> = ({ repoPath, filePath, onCompare }) => {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<Branches>({ local: [], remote: [] });
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [tab, setTab] = useState<"branches" | "commits">("branches");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    invoke<Branches>("git_get_all_branches", { rootDir: repoPath })
      .then((res) => {
        if (!cancelled) setBranches({ local: res.local ?? [], remote: res.remote ?? [] });
      })
      .catch((err) => console.warn("Failed to load branches for compare:", err));
    invoke<CommitInfo[]>("git_get_file_commit_history", { rootDir: repoPath, filePath })
      .then((res) => {
        if (!cancelled) setCommits(res ?? []);
      })
      .catch((err) => console.warn("Failed to load file history for compare:", err));
    return () => {
      cancelled = true;
    };
  }, [open, repoPath, filePath]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const choose = (revision: string) => {
    setOpen(false);
    onCompare(revision);
  };

  const renderGroup = (label: string, names: string[]) =>
    names.length > 0 && (
      <div>
        <div className="px-3 py-1 text-[9px] uppercase font-bold text-[var(--text-muted)]">{label}</div>
        {names.map((name) => (
          <button
            key={`${label}:${name}`}
            onClick={() => choose(name)}
            className="w-full text-left px-3 py-1 text-[11px] font-mono text-[var(--text-light)] hover:bg-[var(--color-surface-sunken)] cursor-pointer truncate"
          >
            {name}
          </button>
        ))}
      </div>
    );

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-light)] hover:border-[var(--border-active)] p-1.5 rounded-md text-[10px] font-mono font-bold transition-all shadow-md cursor-pointer flex items-center space-x-1"
        title="Compare this file with a branch or revision"
      >
        <GitCompare size={10} />
        <span>Compare</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-[9998] w-80 rounded-lg border border-[var(--border-color)] bg-[var(--bg-sidebar)] shadow-2xl overflow-hidden font-mono">
          <div className="flex border-b border-[var(--border-color)] text-[10px] font-bold">
            {(["branches", "commits"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-1.5 cursor-pointer capitalize ${
                  tab === t
                    ? "text-[var(--text-light)] border-b-2 border-[var(--accent-color)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-light)]"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {tab === "branches" ? (
              <>
                {renderGroup("Local branches", branches.local)}
                {renderGroup("Remote branches", branches.remote)}
                {branches.local.length + branches.remote.length === 0 && (
                  <div className="px-3 py-2 text-[11px] text-[var(--text-muted)]">No branches found</div>
                )}
              </>
            ) : commits.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-[var(--text-muted)]">No commits touch this file</div>
            ) : (
              commits.map((c) => (
                <button
                  key={c.hash}
                  onClick={() => choose(c.hash)}
                  className="w-full text-left px-3 py-1.5 hover:bg-[var(--color-surface-sunken)] cursor-pointer"
                >
                  <div className="text-[11px] text-[var(--text-light)] truncate">
                    <span className="text-[var(--accent-color)]">{c.short_hash ?? c.shortHash ?? c.hash.slice(0, 7)}</span>{" "}
                    {c.subject}
                  </div>
                  <div className="text-[9px] text-[var(--text-muted)] truncate">
                    {c.author} · {c.date}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
