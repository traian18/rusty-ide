import { ArrowUp, Copy, Check, GitBranch, Tag, User, Calendar, ExternalLink } from "lucide-react";
import type { CommitInfo } from "../model";
import type { GitHistoryModel } from "./useGitHistory";
import { parseDecorations } from "../commitDecorations";

export function CommitRow({ commit, index, model }: { commit: CommitInfo; index: number; model: GitHistoryModel }) {
  const {
    repoPath,
    commits,
    copiedHash,
    expandedCommit,
    commitFiles,
    loadingFiles,
    handleToggleExpand,
    handleOpenFileDiff,
    handleRevertCommit,
    handleResetToCommit,
    handleCopyHash,
  } = model;
      const decorations = parseDecorations(commit.decorations);
      const isExpanded = expandedCommit === commit.hash;

      return (
        <div key={commit.hash} className="flex flex-col border-b border-[var(--border-color)]/25">
          {/* Main Commit Row Info */}
          <div
            onClick={() => handleToggleExpand(commit.hash)}
            className="flex items-stretch h-14 hover:bg-[var(--accent-bg)]/20 transition-colors group/row cursor-pointer"
          >
            {/* Timeline Graphic Graph Column */}
            <div className="w-12 flex-shrink-0 flex items-center justify-center relative">
              <svg className="w-full h-full" viewBox="0 0 48 56" preserveAspectRatio="none">
                {/* Connection track lines */}
                {index > 0 && (
                  <line
                    x1="24"
                    y1="0"
                    x2="24"
                    y2="28"
                    stroke={commit.is_unpushed ? "var(--color-status-warning)" : "var(--color-border-default)"}
                    strokeWidth="2"
                  />
                )}
                {index < commits.length - 1 && (
                  <line
                    x1="24"
                    y1="28"
                    x2="24"
                    y2="56"
                    stroke={commits[index + 1].is_unpushed ? "var(--color-status-warning)" : "var(--color-border-default)"}
                    strokeWidth="2"
                  />
                )}

                {/* Timeline node circle */}
                <circle
                  cx="24"
                  cy="28"
                  r={commit.is_unpushed ? "6" : "4.5"}
                  fill={commit.is_unpushed ? "var(--color-status-warning-solid)" : "var(--color-surface-app)"}
                  stroke={commit.is_unpushed ? "var(--color-status-warning)" : "var(--color-primary)"}
                  strokeWidth="2"
                />
              </svg>
            </div>

            {/* Commit Information Column */}
            <div className="flex-1 min-w-0 pr-6 flex flex-col justify-center space-y-1">
              {/* Subject Row */}
              <div className="flex items-center space-x-2">
                <span className="font-semibold text-[var(--text-light)] truncate max-w-[50%] select-text font-sans text-xs">
                  {commit.subject}
                </span>

                {/* Decorations (Branches/Tags) badges */}
                <div className="flex items-center space-x-1.5 flex-wrap">
                  {decorations.map((dec, i) => {
                    const colors = {
                      head: "bg-[var(--color-status-success-bg)] text-[var(--color-status-success)] border-[var(--color-status-success-border)]",
                      remote: "bg-[var(--color-status-danger-bg)] text-[var(--color-status-danger)] border-[var(--color-status-danger-border)]",
                      tag: "bg-[var(--color-status-warning-bg)] text-[var(--color-status-warning)] border-[var(--color-status-warning-border)]",
                      branch: "bg-[var(--color-status-info-bg)] text-[var(--color-status-info)] border-[var(--color-status-info-border)]",
                    };
                    const icons = {
                      head: <GitBranch size={9} />,
                      remote: <ExternalLink size={8} />,
                      tag: <Tag size={8} />,
                      branch: <GitBranch size={9} />,
                    };
                    return (
                      <span
                        key={i}
                        className={`inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border ${colors[dec.type]}`}
                      >
                        {icons[dec.type]}
                        <span>{dec.name}</span>
                      </span>
                    );
                  })}

                  {/* Outgoing Commit Badge */}
                  {commit.is_unpushed && (
                    <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-[var(--color-status-warning-bg)] text-[var(--color-status-warning)] border border-[var(--color-status-warning-border)]">
                      <ArrowUp size={9} />
                      <span>Outgoing</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Metadata Row */}
              <div className="flex items-center text-[10px] text-[var(--text-muted)] font-mono space-x-4">
                <div className="flex items-center space-x-1">
                  <User size={10} className="text-[var(--text-muted)]/75" />
                  <span className="truncate max-w-[120px]">{commit.author}</span>
                </div>
                <div className="flex items-center space-x-1">
                  <Calendar size={10} className="text-[var(--text-muted)]/75" />
                  <span>{commit.date}</span>
                </div>
                <div className="flex items-center space-x-1.5 group/hash">
                  <span className="text-[var(--text-muted)]/70 select-text font-bold">
                    {commit.short_hash}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopyHash(commit.hash);
                    }}
                    className="text-[var(--text-muted)] hover:text-[var(--text-light)] p-0.5 rounded transition-all cursor-pointer opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100"
                    title="Copy commit SHA"
                  >
                    {copiedHash === commit.hash ? (
                      <Check size={9} className="text-[var(--color-status-success)]" />
                    ) : (
                      <Copy size={9} />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Expanded Changed Files List */}
          {isExpanded && (
            <div className="flex items-stretch bg-[var(--color-surface-sunken)]">
              {/* Timeline vertical line extension */}
              <div className="w-12 flex-shrink-0 flex items-center justify-center relative">
                <svg className="w-full h-full" viewBox="0 0 48 100" preserveAspectRatio="none">
                  {index < commits.length - 1 && (
                    <line
                      x1="24"
                      y1="0"
                      x2="24"
                      y2="100"
                      stroke={commits[index + 1].is_unpushed ? "var(--color-status-warning)" : "var(--color-border-default)"}
                      strokeWidth="2"
                    />
                  )}
                </svg>
              </div>

              {/* Files list container */}
              <div className="flex-1 pr-6 py-2.5 space-y-1.5 select-none font-mono text-[11px] text-[var(--text-normal)]">
                <div className="text-[9px] uppercase font-bold text-[var(--text-muted)] tracking-wider mb-1 flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <span>Changed Files</span>
                    {loadingFiles ? <span>loading...</span> : <span>{commitFiles.length} item(s)</span>}
                  </div>

                  {/* Commit Rollback Actions */}
                  <div className="flex items-center space-x-2.5 font-mono select-none">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRevertCommit(commit.hash);
                      }}
                      className="text-[9px] hover:text-[var(--color-status-warning)] text-[var(--text-muted)] hover:underline cursor-pointer flex items-center space-x-1 font-bold"
                      title="Revert changes made by this commit"
                    >
                      <span>[ revert commit ]</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleResetToCommit(commit.hash);
                      }}
                      className="text-[9px] hover:text-[var(--color-status-danger)] text-[var(--text-muted)] hover:underline cursor-pointer flex items-center space-x-1 font-bold"
                      title="Hard reset branch to this commit point"
                    >
                      <span>[ reset branch to here ]</span>
                    </button>
                  </div>
                </div>

                {loadingFiles ? (
                  <div className="py-2 text-[10px] text-[var(--text-muted)] italic">
                    Loading modifications...
                  </div>
                ) : commitFiles.length === 0 ? (
                  <div className="py-2 text-[10px] text-[var(--text-muted)] italic">
                    No files changed in this commit.
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {commitFiles.map((file) => {
                      const statusColors = {
                        added: "text-[var(--color-status-success)] font-bold",
                        deleted: "text-[var(--color-status-danger)] font-bold",
                        modified: "text-[var(--color-status-warning)] font-bold",
                      };
                      const statusLabels = {
                        added: "A",
                        deleted: "D",
                        modified: "M",
                      };
                      const relativePath = file.path.replace(repoPath, "").replace(/^\//, "");

                      return (
                        <div
                          key={file.path}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenFileDiff(file.path, file.name, commit.hash, commit.short_hash);
                          }}
                          className="group/file flex items-center justify-between px-2 py-1 rounded hover:bg-[var(--accent-bg)]/25 cursor-pointer transition-colors border border-transparent hover:border-[var(--border-color)]/30"
                        >
                          <div className="flex items-center space-x-2 truncate">
                            <span className={`w-4 text-center text-[10px] font-bold ${statusColors[file.status_type as keyof typeof statusColors] || "text-[var(--color-fg-default)]"}`}>
                              {statusLabels[file.status_type as keyof typeof statusLabels] || "M"}
                            </span>
                            <span className="text-[var(--text-normal)] group-hover/file:text-[var(--text-light)] truncate">
                              {file.name}
                            </span>
                            <span className="text-[9px] text-[var(--text-muted)] truncate">
                              {relativePath}
                            </span>
                          </div>
                          <div className="opacity-0 group-hover/file:opacity-100 text-[10px] text-[var(--accent-color)] font-mono font-bold select-none pr-1">
                            Compare &rarr;
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      );
}
