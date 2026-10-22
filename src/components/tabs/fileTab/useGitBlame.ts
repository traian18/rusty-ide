import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { FileLocation, FileTabData } from "./fileLocation";

interface BlameLine {
  line_number: number;
  author: string;
  date: string;
}

export interface GitBlame {
  showBlame: boolean;
  toggle: () => void;
  /** Monaco's line-number renderer: the line's author and date beside it while blame is on. */
  lineNumbers: (lineNumber: number) => string;
  lineNumbersMinChars: number;
}

const PLAIN_LINE_NUMBER_CHARS = 5;

function blameLabel(blame: BlameLine, lineNumber: number): string {
  return `${blame.author} (${blame.date}) │ ${lineNumber}`;
}

function indexBlame(lines: BlameLine[]): { byLine: Record<number, BlameLine>; maxLabelLength: number } {
  const byLine: Record<number, BlameLine> = {};
  let maxLabelLength = PLAIN_LINE_NUMBER_CHARS;
  for (const line of lines) {
    byLine[line.line_number] = line;
    maxLabelLength = Math.max(maxLabelLength, blameLabel(line, line.line_number).length);
  }
  return { byLine, maxLabelLength };
}

export function useGitBlame(tab: FileTabData, location: FileLocation): GitBlame {
  const [showBlame, setShowBlame] = useState(false);
  const [blameData, setBlameData] = useState<Record<number, BlameLine>>({});
  const [maxBlameLength, setMaxBlameLength] = useState(PLAIN_LINE_NUMBER_CHARS);

  // Blame is a per-line annotation on git commits, so only a file git tracks has one.
  useEffect(() => {
    if (!location.tracksGit) return;
    const fetchBlame = async () => {
      try {
        const lines: BlameLine[] = await invoke("git_blame", { rootDir: location.repoPath, filePath: tab.path });
        const { byLine, maxLabelLength } = indexBlame(lines);
        setBlameData(byLine);
        setMaxBlameLength(maxLabelLength);
      } catch (err) {
        console.warn("Failed to fetch git blame for file:", err);
      }
    };
    fetchBlame();
  }, [tab.path, location.repoPath]);

  return {
    showBlame,
    toggle: () => setShowBlame((prev) => !prev),
    lineNumbers: (lineNumber) => (showBlame && blameData[lineNumber] ? blameLabel(blameData[lineNumber], lineNumber) : String(lineNumber)),
    lineNumbersMinChars: showBlame ? maxBlameLength + 2 : PLAIN_LINE_NUMBER_CHARS,
  };
}
