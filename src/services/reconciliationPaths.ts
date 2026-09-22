const normalizeSlashes = (value: string) => value.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/");

const isAbsolutePath = (value: string) => value.startsWith("/") || /^[A-Za-z]:\//.test(value);

const normalizeRelativeParts = (value: string): string[] => {
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) throw new Error(`Reconciliation file must be inside the workspace: ${value}`);
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts;
};

/**
 * Map a task/VFS path to the currently open workspace. Saved canvases can
 * contain absolute VFS keys from an older home directory; those are accepted
 * only when the same workspace-directory component and relative suffix exist.
 */
export function normalizeReconciliationPath(workspaceRoot: string, filePath: string): string {
  const rawRoot = normalizeSlashes(workspaceRoot).replace(/\/$/, "");
  const rawFile = normalizeSlashes(filePath);
  if (!rawRoot) throw new Error("No workspace root is available for reconciliation.");
  if (!rawFile) throw new Error("A reconciliation file path is required.");

  const rootParts = rawRoot.split("/").filter(Boolean);
  const workspaceDirectory = rootParts[rootParts.length - 1];
  const comparisonRoot = rawRoot.toLocaleLowerCase();
  const comparisonFile = rawFile.toLocaleLowerCase();
  let relativeParts: string[];

  if (!isAbsolutePath(rawFile)) {
    relativeParts = normalizeRelativeParts(rawFile);
  } else if (comparisonFile.startsWith(`${comparisonRoot}/`)) {
    relativeParts = normalizeRelativeParts(rawFile.slice(rawRoot.length + 1));
  } else {
    const fileParts = rawFile.split("/").filter(Boolean);
    let workspaceIndex = -1;
    for (let index = fileParts.length - 1; index >= 0; index -= 1) {
      if (fileParts[index].toLocaleLowerCase() === workspaceDirectory.toLocaleLowerCase()) {
        workspaceIndex = index;
        break;
      }
    }
    if (workspaceIndex < 0 || workspaceIndex === fileParts.length - 1) {
      throw new Error(`Reconciliation file must be inside the workspace: ${filePath}`);
    }
    relativeParts = normalizeRelativeParts(fileParts.slice(workspaceIndex + 1).join("/"));
  }

  if (relativeParts.length === 0) {
    throw new Error(`Reconciliation file must be inside the workspace: ${filePath}`);
  }
  const normalized = `${rawRoot}/${relativeParts.join("/")}`;
  return workspaceRoot.includes("\\") ? normalized.replace(/\//g, "\\") : normalized;
}

export interface ReconciliationTaskFileNode {
  id: string;
  modifiedFiles: string[];
  generatedFileContents?: Record<string, string>;
}

export interface ReconciliationTaskFileRecord {
  path: string;
  sourcePath: string;
  taskIds: string[];
  sourceSignature: string;
  /** Exact TaskNode snapshot when this path has a single owner. */
  taskContent?: string;
}

function contentForWorkspacePath(
  workspaceRoot: string,
  contents: Record<string, string> | undefined,
  workspacePath: string,
): string | undefined {
  for (const [filePath, content] of Object.entries(contents || {})) {
    try {
      if (normalizeReconciliationPath(workspaceRoot, filePath) === workspacePath) return content;
    } catch {
      // Invalid snapshot keys cannot describe this active-workspace file.
    }
  }
  return undefined;
}

function stableSignature(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `v1-${(hash >>> 0).toString(16).padStart(8, "0")}-${value.length}`;
}

/** Build canonical task-file identities and signatures without reading disk. */
export function buildReconciliationTaskFileRecords(
  workspaceRoot: string,
  nodes: ReconciliationTaskFileNode[],
  reconciledFiles: string[] = [],
): Record<string, ReconciliationTaskFileRecord> {
  const reconciled = new Set(reconciledFiles);
  const owners = new Map<string, Array<{ id: string; content?: string; sourcePath: string }>>();

  for (const node of nodes) {
    for (const filePath of node.modifiedFiles || []) {
      let workspacePath = filePath;
      try {
        workspacePath = normalizeReconciliationPath(workspaceRoot, filePath);
      } catch {
        // Preserve invalid paths so reconciliation can report them precisely.
      }
      const entries = owners.get(workspacePath) || [];
      entries.push({
        id: node.id,
        content: contentForWorkspacePath(workspaceRoot, node.generatedFileContents, workspacePath),
        sourcePath: reconciled.has(workspacePath) ? workspacePath : filePath,
      });
      owners.set(workspacePath, entries);
    }
  }

  return Object.fromEntries(Array.from(owners, ([workspacePath, entries]) => {
    const sorted = [...entries].sort((left, right) => left.id.localeCompare(right.id));
    const canonicalSource = sorted.find((entry) => entry.sourcePath === workspacePath)?.sourcePath;
    return [workspacePath, {
      path: workspacePath,
      sourcePath: canonicalSource || sorted[0]?.sourcePath || workspacePath,
      taskIds: sorted.map((entry) => entry.id),
      sourceSignature: stableSignature(JSON.stringify(sorted.map(({ id, content }) => [id, content ?? null]))),
      taskContent: sorted.length === 1 ? sorted[0].content : undefined,
    }];
  }));
}
