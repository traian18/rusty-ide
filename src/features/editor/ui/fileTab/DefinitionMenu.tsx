import React from "react";
import { FileSearch, Loader2, X } from "lucide-react";
import { DEFINITION_MENU_WIDTH, type DefinitionCandidate } from "./definitionSearch";

export interface DefinitionMenuState {
  symbol: string;
  x: number;
  y: number;
  loading: boolean;
  results: DefinitionCandidate[];
  message?: string;
}

interface DefinitionMenuProps {
  menu: DefinitionMenuState;
  onOpen: (candidate: DefinitionCandidate) => void;
  onClose: () => void;
}

const CandidateButton: React.FC<{ candidate: DefinitionCandidate; onOpen: (candidate: DefinitionCandidate) => void }> = ({ candidate, onOpen }) => (
  <button
    onClick={() => onOpen(candidate)}
    className="w-full text-left px-3 py-2 border-b border-[var(--border-color)]/30 last:border-b-0 hover:bg-[var(--accent-bg)]/20 transition-colors"
    title={`${candidate.relativePath}:${candidate.line}`}
  >
    <div className="flex items-center justify-between space-x-2">
      <span className="text-[11px] text-[var(--text-light)] truncate">{candidate.name}</span>
      <span className="text-[9px] text-[var(--text-muted)] flex-shrink-0">Line {candidate.line}</span>
    </div>
    <div className="text-[10px] text-[var(--text-muted)] truncate mt-0.5">{candidate.relativePath}</div>
    <div className="text-[10px] text-[var(--text-normal)] truncate mt-1">{candidate.content}</div>
  </button>
);

/** The likely definitions of a Cmd/Ctrl-clicked symbol, floating beside it. */
export const DefinitionMenu: React.FC<DefinitionMenuProps> = ({ menu, onOpen, onClose }) => (
  <div
    className="absolute z-[9998] max-w-[calc(100%-24px)] rounded-lg border border-[var(--border-color)] bg-[var(--bg-sidebar)] shadow-2xl overflow-hidden font-mono"
    style={{ left: menu.x, top: menu.y, width: DEFINITION_MENU_WIDTH }}
    onMouseDown={(e) => e.stopPropagation()}
  >
    <div className="px-3 py-2 border-b border-[var(--border-color)] bg-[var(--color-surface-sunken)] flex items-center justify-between">
      <div className="flex items-center space-x-2 min-w-0">
        <FileSearch size={13} className="text-[var(--accent-color)] flex-shrink-0" />
        <span className="text-[10px] text-[var(--text-muted)] uppercase font-bold flex-shrink-0">Definitions</span>
        <span className="text-xs text-[var(--text-light)] truncate">{menu.symbol}</span>
      </div>
      <button
        onClick={onClose}
        className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-light)] hover:bg-[var(--bg-app)]"
        title="Close"
      >
        <X size={13} />
      </button>
    </div>

    <div className="max-h-[260px] overflow-y-auto">
      {menu.loading && (
        <div className="px-3 py-5 flex items-center justify-center space-x-2 text-[11px] text-[var(--text-muted)]">
          <Loader2 size={14} className="animate-spin text-[var(--accent-color)]" />
          <span>Searching workspace...</span>
        </div>
      )}

      {!menu.loading && menu.message && (
        <div className="px-3 py-5 text-center text-[11px] text-[var(--text-muted)]">
          {menu.message}
        </div>
      )}

      {!menu.loading && menu.results.map((candidate) => (
        <CandidateButton key={`${candidate.path}:${candidate.line}:${candidate.content}`} candidate={candidate} onOpen={onOpen} />
      ))}
    </div>
  </div>
);
