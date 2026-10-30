import { type JsonObject, stableStringify } from "../model";
import { type CatalogEntry } from "../service/workflowCatalogService";

export type Mode = "workflows" | "profiles";

export interface Doc {
  path: string;
  document: JsonObject;
  /** Serialized form on disk; `null` for a document not written yet. */
  saved: string | null;
}

export interface DrillOrigin {
  workflowPath: string;
  stepId: string;
}

export const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export const VALIDATION_DELAY_MS = 250;

export const isDirty = (doc: Doc) => doc.saved !== stableStringify(doc.document);

/** A catalog entry as the editor tracks it: saved exactly as listed. */
export function stored({ path, document }: CatalogEntry): Doc {
  return { path, document, saved: stableStringify(document) };
}

export function mergeExternalDocuments(current: Doc[], incoming: Array<{ path: string; document: JsonObject; saved: string | null }>): Doc[] {
  const byPath = new Map(incoming.map((doc) => [doc.path, doc]));
  const merged = current.map((doc) => {
    if (isDirty(doc)) return doc;
    const fresh = byPath.get(doc.path);
    return fresh ? { path: fresh.path, document: fresh.document, saved: fresh.saved } : doc;
  });
  const known = new Set(current.map((doc) => doc.path));
  return [...merged, ...incoming.filter((doc) => !known.has(doc.path))];
}
