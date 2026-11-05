import { useEffect, useRef, useState } from "react";
import { VfsRegistry, VFS_CHANGED_EVENT, type VfsChangedDetail } from "../../../canvas";
import { editorClient } from "../../client";
import type { FileLocation, FileTabData } from "./fileLocation";
import { onFileText, receiveFileText, shareFileText } from "./fileTextChannel";
import { unsavedFileText } from "./useAutoSave";
import {
  type FileSafety,
  type ImagePreview,
  checkFileSafety,
  readImagePreview,
  shebangLanguageFor,
  vfsChangeAffects,
} from "./fileLoading";

/** The most often an open file is read again while its workspace keeps changing. */
const RELOAD_DELAY_MS = 250;

export interface FileContent {
  fileContent: string;
  /** Sets the text in every open tab of this file. */
  setFileContent: (value: string) => void;
  loading: boolean;
  fileSafety: FileSafety;
  /** Set only when a shebang line names a language the filename doesn't. */
  shebangLanguage: string | null;
  /** Set instead of fileContent/fileSafety for an image, or its error. */
  imagePreview: ImagePreview | null;
  imageLoadError: string | null;
  /** A too-large file opens read-only until the user loads it anyway. */
  readOnly: boolean;
  loadAnyway: () => void;
}

/** Loads the tab's file (text through the VFS registry, images as data
 * URLs) and keeps it in step with the disk and with a canvas's VFS. */
export function useFileContent(tab: FileTabData, location: FileLocation): FileContent {
  const [fileContent, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [shebangLanguage, setShebangLanguage] = useState<string | null>(null);
  // "safe" is the default so a file loaded before the check runs (or one the
  // check errored on) renders exactly like it did before the check existed.
  const [fileSafety, setFileSafety] = useState<FileSafety>({ kind: "safe" });
  // "Load anyway" override for a too_large file, reset per file.
  const [forceEditableLargeFile, setForceEditableLargeFile] = useState(false);
  const [imagePreview, setImagePreview] = useState<ImagePreview | null>(null);
  const [imageLoadError, setImageLoadError] = useState<string | null>(null);
  const { canvasTabId, isImage, monacoModelUri } = location;
  // Moves on with every read and every edit, so a read whose text has been overtaken is dropped.
  const textVersion = useRef(0);

  /** Brings every tab of the file up to date with what a read finds, unless
   * typing is still unsaved: that text wins, and saving it replaces the file. */
  const readText = async () => {
    const version = ++textVersion.current;
    const safety = await checkFileSafety(tab.path, tab.vfsTabId);
    setFileSafety(safety);
    if (safety.kind === "binary") return;
    console.log(`FileTab reading VFS path: ${tab.path} (canvas: ${canvasTabId || "global"})`);
    const content: string = await VfsRegistry.getOrCreate(canvasTabId).readFile(tab.path);
    setShebangLanguage(shebangLanguageFor(tab.path, content));
    if (version !== textVersion.current) return;
    const unsaved = unsavedFileText(monacoModelUri);
    if (unsaved === undefined) receiveFileText(monacoModelUri, content);
    else setText(unsaved);
  };

  useEffect(() => {
    setShebangLanguage(null);
    setFileSafety({ kind: "safe" });
    setForceEditableLargeFile(false);
    setImagePreview(null);
    setImageLoadError(null);

    const loadImage = async () => {
      try {
        setImagePreview(await readImagePreview(tab.path));
      } catch (err: any) {
        console.error("FileTab failed to read image:", err);
        setImageLoadError(err?.message ? String(err.message) : "Failed to read image file");
      } finally {
        setLoading(false);
      }
    };

    const loadText = async () => {
      try {
        await readText();
      } catch (err: any) {
        console.error("FileTab failed to read VFS:", err);
        setText(`// Error reading file: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    void (isImage ? loadImage() : loadText());
  }, [tab.path, tab.id, tab.vfsTabId, canvasTabId, isImage, monacoModelUri]);

  useEffect(() => onFileText(monacoModelUri, (text) => {
    textVersion.current += 1;
    setText(text);
  }), [monacoModelUri]);

  // Follow changes made outside the app (an agent, the terminal, git). The event
  // does not say which file changed, so this reads the tab's own file again.
  useEffect(() => {
    if (isImage) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stop: (() => void) | undefined;
    let live = true;
    const reload = () => {
      timer = undefined;
      readText().catch((err) => console.warn("Live file reload failed:", err));
    };
    editorClient.onWorkspaceChanged(() => {
      timer ??= setTimeout(reload, RELOAD_DELAY_MS);
    }).then((unlisten) => (live ? (stop = unlisten) : unlisten()))
      .catch((err) => console.error("Failed to follow file changes:", err));
    return () => {
      live = false;
      clearTimeout(timer);
      stop?.();
    };
  }, [tab.path, tab.vfsTabId, canvasTabId, isImage, monacoModelUri]);

  // Live reload content when canvas VFS changes
  useEffect(() => {
    if (!canvasTabId) return;
    const handleVfsChanged = (event: Event) => {
      if (!vfsChangeAffects((event as CustomEvent<VfsChangedDetail>).detail, canvasTabId, tab.path)) return;
      readText().catch((err) => console.warn("Live VFS reload failed:", err));
    };
    window.addEventListener(VFS_CHANGED_EVENT, handleVfsChanged);
    return () => window.removeEventListener(VFS_CHANGED_EVENT, handleVfsChanged);
  }, [canvasTabId, tab.path, tab.vfsTabId, monacoModelUri]);

  return {
    fileContent,
    setFileContent: (value) => shareFileText(monacoModelUri, value),
    loading,
    fileSafety,
    shebangLanguage,
    imagePreview,
    imageLoadError,
    readOnly: fileSafety.kind === "too_large" && !forceEditableLargeFile,
    loadAnyway: () => setForceEditableLargeFile(true),
  };
}
