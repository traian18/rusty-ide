import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { computeLineChanges, toGutterDecorations } from "../fileTabGitChanges";
import type { FileLocation, FileTabData } from "./fileLocation";

export interface GitGutter {
  /** Reloads the HEAD baseline; a save may follow a commit or checkout that moved HEAD. */
  reloadHead: () => Promise<void>;
  /** Called when the editor mounts. */
  attach: () => void;
}

/** The live change gutter: added/modified/deleted bars from the buffer
 * against the file at HEAD, following typing. */
export function useGitGutter(
  tab: FileTabData,
  location: FileLocation,
  editorRef: MutableRefObject<any>,
  fileContent: string,
): GitGutter {
  // HEAD version of the file (null = not loaded / not applicable) and the Monaco
  // decoration collection that paints the bars.
  const [headContent, setHeadContent] = useState<string | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const decorationsRef = useRef<any>(null);
  const { tracksGit, repoPath } = location;

  const reloadHead = async () => {
    if (!tracksGit) return;
    try {
      setHeadContent(await invoke<string>("git_get_head_content", { rootDir: repoPath, filePath: tab.path }));
    } catch (err) {
      console.warn("Failed to load HEAD content for change gutter:", err);
      setHeadContent(null);
    }
  };

  useEffect(() => {
    setHeadContent(null);
    reloadHead();
  }, [tab.path, repoPath]);

  // Recompute the gutter from the live buffer (debounced) so bars follow typing.
  useEffect(() => {
    const editor = editorRef.current;
    const baseline = tracksGit ? headContent : null;
    if (!editorReady || !editor || baseline === null) {
      decorationsRef.current?.clear();
      return;
    }
    const timer = window.setTimeout(() => {
      const decorations = toGutterDecorations(computeLineChanges(baseline, fileContent));
      if (decorationsRef.current) decorationsRef.current.set(decorations);
      else decorationsRef.current = editor.createDecorationsCollection(decorations);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [fileContent, headContent, editorReady, tracksGit]);

  return {
    reloadHead,
    attach: () => {
      // A remount (tab move) creates a new model, so a stale collection must not be reused.
      decorationsRef.current = null;
      setEditorReady(true);
    },
  };
}
