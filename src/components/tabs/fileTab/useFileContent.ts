import { useEffect, useState } from "react";
import { VfsRegistry, VFS_CHANGED_EVENT, type VfsChangedDetail } from "../../../services/vfs";
import type { FileLocation, FileTabData } from "./fileLocation";
import {
  type FileSafety,
  type ImagePreview,
  checkFileSafety,
  readImagePreview,
  shebangLanguageFor,
  vfsChangeAffects,
} from "./fileLoading";

export interface FileContent {
  fileContent: string;
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
 * URLs) and keeps a canvas file in step with its VFS. */
export function useFileContent(tab: FileTabData, location: FileLocation): FileContent {
  const [fileContent, setFileContent] = useState("");
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
      const safety = await checkFileSafety(tab.path, tab.vfsTabId);
      setFileSafety(safety);
      if (safety.kind === "binary") {
        setLoading(false);
        return;
      }
      try {
        console.log(`FileTab reading VFS path: ${tab.path} (canvas: ${canvasTabId || "global"})`);
        const content: string = await VfsRegistry.getOrCreate(canvasTabId).readFile(tab.path);
        setFileContent(content);
        setShebangLanguage(shebangLanguageFor(tab.path, content));
      } catch (err: any) {
        console.error("FileTab failed to read VFS:", err);
        setFileContent(`// Error reading file: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    void (isImage ? loadImage() : loadText());
  }, [tab.path, tab.id, tab.vfsTabId, canvasTabId, isImage, monacoModelUri]);

  // Live reload content when canvas VFS changes
  useEffect(() => {
    if (!canvasTabId) return;
    const handleVfsChanged = (event: Event) => {
      if (!vfsChangeAffects((event as CustomEvent<VfsChangedDetail>).detail, canvasTabId, tab.path)) return;
      VfsRegistry.getOrCreate(canvasTabId)
        .readFile(tab.path)
        .then((content) => setFileContent(content))
        .catch((err) => console.warn("Live VFS reload failed:", err));
    };
    window.addEventListener(VFS_CHANGED_EVENT, handleVfsChanged);
    return () => window.removeEventListener(VFS_CHANGED_EVENT, handleVfsChanged);
  }, [canvasTabId, tab.path]);

  return {
    fileContent,
    setFileContent,
    loading,
    fileSafety,
    shebangLanguage,
    imagePreview,
    imageLoadError,
    readOnly: fileSafety.kind === "too_large" && !forceEditableLargeFile,
    loadAnyway: () => setForceEditableLargeFile(true),
  };
}
