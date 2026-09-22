const FILE_MUTATION_TOOLS = new Set([
  "write", "write_file", "edit", "edit_file", "multiedit", "notebookedit", "file_change",
]);

function isAbsolute(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

function resolvePath(root: string, path: string): string {
  if (isAbsolute(path)) return path;
  return `${root.replace(/[\\/]$/, "")}/${path.replace(/^\.\//, "")}`;
}

function stringsFromChanges(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((change) => {
    if (!change || typeof change !== "object") return [];
    const item = change as Record<string, unknown>;
    const path = item.path ?? item.file_path ?? item.filePath;
    return typeof path === "string" ? [path] : [];
  });
}

/** Extracts paths from the structured edit events emitted by managed coding
 * runtimes. Shell commands remain opaque; runtimes should emit file_change
 * events for edits made by those commands. */
export function changedPathsFromTool(toolName: string, args: unknown, workspaceRoot: string): string[] {
  if (!FILE_MUTATION_TOOLS.has(toolName.toLowerCase()) || !args || typeof args !== "object") return [];
  const value = args as Record<string, unknown>;
  const direct = value.path ?? value.file_path ?? value.filePath ?? value.notebook_path;
  const candidates = [
    ...(typeof direct === "string" ? [direct] : []),
    ...stringsFromChanges(value.changes),
  ];
  return [...new Set(candidates
    .map((path) => path.trim())
    .filter(Boolean)
    .map((path) => resolvePath(workspaceRoot, path)))];
}
