import { useEffect, useRef, useState, type RefObject } from "react";
import { useWorkspaceStore } from "../../../store";
import { searchService } from "../../../services/searchService";
import type { FileTabData } from "./fileLocation";
import type { DefinitionMenuState } from "./DefinitionMenu";
import {
  type DefinitionCandidate,
  containerBox,
  definitionAnchor,
  definitionClickSymbol,
  definitionMenuPosition,
  rankDefinitionCandidates,
} from "./definitionSearch";

export interface DefinitionLookup {
  menu: DefinitionMenuState | null;
  /** Opens the menu for a Cmd/Ctrl-click on an identifier; false for any other click. */
  lookup: (editor: any, event: any) => Promise<boolean>;
  open: (candidate: DefinitionCandidate) => void;
  close: () => void;
}

type SearchOutcome = Pick<DefinitionMenuState, "results" | "message">;

export function useDefinitionLookup(tab: FileTabData, rootPath: string, containerRef: RefObject<HTMLDivElement | null>): DefinitionLookup {
  const openTab = useWorkspaceStore((state) => state.openTab);
  const [menu, setMenu] = useState<DefinitionMenuState | null>(null);
  // Only the latest lookup may fill the menu.
  const requestRef = useRef(0);

  useEffect(() => {
    if (!menu) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [menu]);

  const findCandidates = async (symbol: string, currentLine: number): Promise<DefinitionCandidate[]> => {
    if (!rootPath) return [];
    const matches = await searchService.searchProject({
      rootDir: rootPath,
      query: symbol,
      matchCase: true,
      wholeWord: true,
      isRegex: false,
    });
    return rankDefinitionCandidates(matches, symbol, { path: tab.path, line: currentLine }, rootPath);
  };

  const search = async (symbol: string, currentLine: number): Promise<SearchOutcome> => {
    try {
      const results = await findCandidates(symbol, currentLine);
      return { results, message: results.length === 0 ? "No likely definitions found" : undefined };
    } catch (err: any) {
      return { results: [], message: err?.message || "Search failed" };
    }
  };

  const lookup = async (editor: any, event: any): Promise<boolean> => {
    const symbol = definitionClickSymbol(editor, event);
    if (!symbol) return false;
    const browserEvent = event.event.browserEvent;
    browserEvent.preventDefault?.();
    browserEvent.stopPropagation?.();

    const requestId = ++requestRef.current;
    const position = event.target.position;
    const at = definitionMenuPosition(definitionAnchor(editor, position, browserEvent), containerBox(containerRef.current?.getBoundingClientRect()));
    setMenu({ symbol, x: at.x, y: at.y, loading: true, results: [] });

    const outcome = await search(symbol, position.lineNumber);
    if (requestRef.current !== requestId) return true;
    setMenu((current) => (current && current.symbol === symbol ? { ...current, loading: false, ...outcome } : current));
    return true;
  };

  const open = (candidate: DefinitionCandidate) => {
    openTab({
      type: "file",
      path: candidate.path,
      title: candidate.name,
      line: candidate.line > 0 ? candidate.line : undefined,
    });
    setMenu(null);
  };

  return { menu, lookup, open, close: () => setMenu(null) };
}
