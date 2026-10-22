import type React from "react";
import { useCallback } from "react";
import { useWorkspaceStore } from "../../store";

/** The workspace path a chat link points at, or undefined for a web link.
 * Only real web URLs belong in the browser. Relative and absolute paths are
 * workspace resources and should use the editor's file-tab flow. */
export function workspaceLinkPath(href: string, rootPath: string | null | undefined): string | undefined {
  if (/^(https?:|mailto:|tel:|\/\/)/i.test(href) || href.startsWith("#")) return undefined;
  if (href.startsWith("/") || !rootPath) return href;
  return `${rootPath.replace(/[\\/]$/, "")}/${href.replace(/^\.\//, "")}`;
}

/** Opens a workspace link in a file tab instead of following it. */
export function useWorkspaceLinkClick() {
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const openTab = useWorkspaceStore((state) => state.openTab);
  return useCallback((href: string, event: React.MouseEvent<HTMLAnchorElement>) => {
    const path = workspaceLinkPath(href, rootPath);
    if (path === undefined) return;
    event.preventDefault();
    openTab({ type: "file", path, title: path.split(/[\\/]/).pop() || path });
  }, [rootPath, openTab]);
}
