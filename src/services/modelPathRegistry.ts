/**
 * Monaco Model Path Registry
 *
 * Maintains a mapping from Monaco model URIs to filesystem paths.
 * Used by FileTab's openCodeEditor handler to resolve definition-jump
 * targets (which may be inmemory:// or file:// URIs) back to real file
 * paths that can be opened as tabs.
 *
 * Also provides a content-matching fallback for inmemory:// URIs that
 * the TypeScript worker creates internally — these aren't in our registry
 * but their content may match a file:// model we created.
 */

const modelPathRegistry = new Map<string, string>();

export function registerModelPath(modelUri: string, filePath: string): void {
  modelPathRegistry.set(modelUri, filePath);
}

export function unregisterModelPath(modelUri: string): void {
  modelPathRegistry.delete(modelUri);
}

export function resolveModelPath(modelUri: string): string | null {
  return modelPathRegistry.get(modelUri) || null;
}

/**
 * Try to resolve an inmemory:// URI to a file path by finding a file://
 * model with matching content. The TypeScript worker creates inmemory
 * models as projections; their content usually matches a real file.
 */
export function resolveInmemoryByContent(
  monaco: any,
  inmemoryUri: any
): string | null {
  if (!monaco) return null;

  const targetModel = monaco.editor.getModel(inmemoryUri);
  if (!targetModel) return null;

  const targetValue = targetModel.getValue();
  if (!targetValue || targetValue.length === 0) return null;

  // Use first 500 chars as a fingerprint for quick comparison.
  const targetFingerprint = targetValue.slice(0, 500);

  const models = monaco.editor.getModels();
  for (const m of models) {
    if (m.uri.scheme !== "file") continue;
    const value = m.getValue();
    if (value && value.slice(0, 500) === targetFingerprint && value === targetValue) {
      const registered = resolveModelPath(m.uri.toString());
      if (registered) return registered;
      // Fallback: extract from the file URI itself.
      const fp = m.uri.fsPath || m.uri.path;
      if (fp) {
        if (fp.startsWith("/") && /^\/[a-zA-Z]:/.test(fp)) {
          return fp.substring(1);
        }
        return fp;
      }
    }
  }
  return null;
}
