/**
 * The import rules that boundaries.test.ts enforces, as pure functions over source text, so the
 * test and any tool that inspects the tree read the same logic. Paths are relative to src/ and use
 * "/", for example "features/git/service.ts".
 */

export interface SourceModule {
  readonly path: string;
  readonly text: string;
}

interface ImportRecord {
  readonly spec: string;
  readonly typeOnly: boolean;
}

// `import x from "…"`, `import "…"`, `export … from "…"`, each at the start of a line.
const STATIC_IMPORT = /^\s*(?:import|export)\s+(type\s+)?(?:[^;'"]*?\s+from\s+)?(["'])([^"'\n]+)\2/gm;
const DYNAMIC_IMPORT = /\bimport\(\s*(["'])([^"'\n]+)\1/g;

/** Keeps the Vitest-only and declaration files out of every rule. */
export function productionModules(sources: Record<string, string>): SourceModule[] {
  return Object.entries(sources)
    .map(([key, text]) => ({ path: key.replace(/^\.\//, ""), text }))
    .filter(({ path }) => !/\.(test|testing)\.tsx?$/.test(path) && !/\.d\.ts$/.test(path) && !path.startsWith("test/"));
}

export function importsOf(text: string): ImportRecord[] {
  const records: ImportRecord[] = [];
  for (const match of text.matchAll(STATIC_IMPORT)) {
    records.push({ spec: match[3], typeOnly: match[1] !== undefined });
  }
  for (const match of text.matchAll(DYNAMIC_IMPORT)) {
    records.push({ spec: match[2], typeOnly: false });
  }
  return records;
}

/**
 * The module a relative import reaches, as a src-relative path without its .ts or .tsx extension.
 * It may name a folder, which then means that folder's index. Package imports resolve to undefined.
 */
export function resolveImport(importer: string, spec: string): string | undefined {
  if (!spec.startsWith(".")) return undefined;
  const slash = importer.lastIndexOf("/");
  const parts = slash === -1 ? [] : importer.slice(0, slash).split("/");
  for (const part of spec.replace(/\?.*$/, "").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/").replace(/\.tsx?$/, "");
}

export function featureOf(path: string): string | undefined {
  return /^features\/([^/]+)\//.exec(path)?.[1];
}

/** Paths under a feature that other features may import: its index and its ui index. */
const PUBLIC_ENTRIES = new Set(["index", "ui", "ui/index"]);

/**
 * The feature a target reaches past its public entry points, or undefined for anything else. The
 * entry points are index.ts (logic, types and clients) and ui/index.ts (views and view hooks).
 */
export function deepFeatureOf(target: string): string | undefined {
  const match = /^features\/([^/]+)\/(.+)$/.exec(target);
  return match && !PUBLIC_ENTRIES.has(match[2]) ? match[1] : undefined;
}

export function lineCount(text: string): number {
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

export function sizeLimit(path: string): number {
  return path.endsWith(".tsx") ? 300 : 400;
}

/** B1: Tauri is called from clients, the harness, or nowhere else. Type-only imports make no call. */
export function tauriOutsideClient(modules: readonly SourceModule[]): string[] {
  return modules
    .filter(({ path }) => !path.startsWith("harness/") && !path.startsWith("lib/platform/"))
    .filter(({ path }) => path.slice(path.lastIndexOf("/") + 1) !== "client.ts")
    .filter(({ text }) => importsOf(text).some(({ spec, typeOnly }) => !typeOnly && spec.startsWith("@tauri-apps/")))
    .map(({ path }) => path);
}

/** B2: a feature reaches another feature only through its index.ts. */
export function crossFeatureDeepImports(modules: readonly SourceModule[]): string[] {
  return modules
    .filter(({ path, text }) => {
      const own = featureOf(path);
      return own !== undefined && importsOf(text).some(({ spec }) => {
        const target = resolveImport(path, spec);
        const reached = target === undefined ? undefined : deepFeatureOf(target);
        return reached !== undefined && reached !== own;
      });
    })
    .map(({ path }) => path);
}

function breaksLayering(path: string, target: string): boolean {
  if (path.startsWith("lib/")) return /^(features|app|harness)(\/|$)/.test(target);
  if (path.startsWith("harness/")) {
    return /^(app|components)(\/|$)/.test(target) || /(^|\/)ui(\/|$)/.test(target) || deepFeatureOf(target) !== undefined;
  }
  if (/^features\/[^/]+\/state\.tsx?$/.test(path)) return target === "store" || target === "store/index";
  return false;
}

/** B3: lib/ stays below everything; the harness reaches features only through index.ts and never reaches views. */
export function layeringBreaks(modules: readonly SourceModule[]): string[] {
  return modules
    .filter(({ path, text }) => importsOf(text).some(({ spec }) => {
      const target = resolveImport(path, spec);
      return target !== undefined && breaksLayering(path, target);
    }))
    .map(({ path }) => path);
}

/** B4: inside a feature, React and .tsx belong to ui/; the rest is plain TypeScript. */
export function reactOutsideUi(modules: readonly SourceModule[]): string[] {
  return modules
    .filter(({ path, text }) => {
      const feature = featureOf(path);
      if (feature === undefined || path.startsWith(`features/${feature}/ui/`)) return false;
      if (path.endsWith(".tsx")) return true;
      return importsOf(text).some(({ spec }) => {
        const target = resolveImport(path, spec);
        return /^react(-dom)?(\/|$)/.test(spec) || (target !== undefined && /^lib\/ui(\/|$)/.test(target));
      });
    })
    .map(({ path }) => path);
}

/** B5: every file over its size limit, with its line count. */
export function oversizedFiles(modules: readonly SourceModule[]): Array<readonly [string, number]> {
  return modules
    .map(({ path, text }) => [path, lineCount(text)] as const)
    .filter(([path, lines]) => lines > sizeLimit(path));
}
