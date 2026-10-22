// Go-to-definition in a file tab, without a language server: a Cmd/Ctrl-
// click on an identifier searches the workspace for it, and each hit is
// scored by how much its line looks like a declaration of that name.

import type { SearchMatch } from "../../../services/searchService";

export type DefinitionCandidate = SearchMatch & { score: number; relativePath: string };

/** Where a lookup started: the open file and the clicked line. */
export interface LookupOrigin {
  path: string;
  line: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const DEFINITION_MENU_WIDTH = 360;
const DEFINITION_MENU_MAX_HEIGHT = 320;
const DEFINITION_MENU_MARGIN = 12;
const MAX_CANDIDATES = 12;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** Line shapes that suggest a declaration of the symbol (positive) or a
 * mere use of it (negative); every shape a line has adds its score. */
const DECLARATION_RULES: Array<{ pattern: (symbol: string) => RegExp; score: number }> = [
  // class Foo, interface Foo, struct Foo, type Foo...
  { pattern: (s) => new RegExp(`\\b(class|interface|enum|record|struct|trait|type)\\s+${s}\\b`), score: 100 },
  // function foo(, def foo(, fn foo(
  { pattern: (s) => new RegExp(`\\b(function|def|fn|func)\\s+${s}\\s*\\(`), score: 95 },
  // a method with modifiers: public static foo(
  { pattern: (s) => new RegExp(`\\b(public|private|protected|static|final|abstract|override|virtual|async|export|pub)\\b.*\\b${s}\\s*\\(`), score: 90 },
  // a typed method: List<String> foo(
  { pattern: (s) => new RegExp(`^\\s*[\\w$<>\\[\\],.?]+(?:\\s+[\\w$<>\\[\\],.?]+)*\\s+${s}\\s*\\(`), score: 80 },
  { pattern: (s) => new RegExp(`^\\s*(const|let|var)\\s+${s}\\b`), score: 75 },
  // an assignment or a field: foo = / foo:
  { pattern: (s) => new RegExp(`^\\s*${s}\\s*[:=]`), score: 65 },
  // a call on an object: x.foo(
  { pattern: (s) => new RegExp(`\\.${s}\\s*\\(`), score: -45 },
  // a statement, not a declaration
  { pattern: () => /^\s*(return|if|while|for|switch|catch)\b/, score: -35 },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The open file's own hits score a little higher, except the clicked line itself. */
function locationScore(match: SearchMatch, origin: LookupOrigin): number {
  if (match.path !== origin.path) return 0;
  return match.line === origin.line ? -4 : 4;
}

/** How likely the match is the symbol's definition; -1 unless it is a
 * content match naming the symbol as a whole word. */
export function scoreDefinitionMatch(match: SearchMatch, symbol: string, origin: LookupOrigin): number {
  if (!match.is_content_match || !match.content) return -1;
  const escaped = escapeRegExp(symbol);
  const line = match.content.trim();
  if (!new RegExp(`\\b${escaped}\\b`).test(line)) return -1;
  const shapeScore = DECLARATION_RULES.reduce((sum, rule) => (rule.pattern(escaped).test(line) ? sum + rule.score : sum), 0);
  return 10 + locationScore(match, origin) + shapeScore;
}

function relativeToRoot(rootPath: string, filePath: string): string {
  if (!rootPath) return filePath;
  return filePath.startsWith(rootPath) ? filePath.slice(rootPath.length).replace(/^\/+/, "") : filePath;
}

/** The likely definitions among the search hits, best first. */
export function rankDefinitionCandidates(matches: SearchMatch[], symbol: string, origin: LookupOrigin, rootPath: string): DefinitionCandidate[] {
  return matches
    .map((match) => ({ ...match, score: scoreDefinitionMatch(match, symbol, origin), relativePath: relativeToRoot(rootPath, match.path) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath) || a.line - b.line)
    .slice(0, MAX_CANDIDATES);
}

/** A click with Cmd (macOS) or Ctrl held. */
export function isModifierClick(browserEvent: { metaKey?: boolean; ctrlKey?: boolean } | undefined): boolean {
  return Boolean(browserEvent?.metaKey || browserEvent?.ctrlKey);
}

/** Monaco's gutter targets: glyph margin (2), line numbers (3), line decorations (4). */
const GUTTER_TARGET_TYPES = new Set([2, 3, 4]);

export function isGutterClick(target: { type?: number } | null | undefined): boolean {
  return target ? GUTTER_TARGET_TYPES.has(target.type as number) : false;
}

/** The identifier under a Cmd/Ctrl-click in the editor, or undefined for any other click. */
export function definitionClickSymbol(editor: any, event: any): string | undefined {
  if (!isModifierClick(event?.event?.browserEvent) || !event.target?.position) return undefined;
  const symbol: string | undefined = editor.getModel()?.getWordAtPosition(event.target.position)?.word;
  return symbol && IDENTIFIER.test(symbol) ? symbol : undefined;
}

/** The container's box, or the window's while it is not mounted. */
export function containerBox(rect: DOMRect | undefined): Box {
  return {
    left: rect?.left ?? 0,
    top: rect?.top ?? 0,
    width: rect?.width ?? window.innerWidth,
    height: rect?.height ?? window.innerHeight,
  };
}

/** Just below the clicked word, or at the mouse when the editor cannot say where the word is. */
export function definitionAnchor(editor: any, position: unknown, fallback: { clientX: number; clientY: number }): Point {
  const editorRect = editor.getDomNode?.()?.getBoundingClientRect?.();
  const visible = editor.getScrolledVisiblePosition?.(position);
  if (!editorRect || !visible) return { x: fallback.clientX, y: fallback.clientY };
  return { x: editorRect.left + visible.left, y: editorRect.top + visible.top + visible.height };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(min, value), max);
}

/** Beside the anchor, flipped to its other side where it would overflow, and kept inside the container. */
export function definitionMenuPosition(anchor: Point, container: Box): Point {
  let x = anchor.x - container.left + 8;
  let y = anchor.y - container.top + 6;
  if (x + DEFINITION_MENU_WIDTH > container.width - DEFINITION_MENU_MARGIN) {
    x = anchor.x - container.left - DEFINITION_MENU_WIDTH - 8;
  }
  if (y + DEFINITION_MENU_MAX_HEIGHT > container.height - DEFINITION_MENU_MARGIN) {
    y = anchor.y - container.top - DEFINITION_MENU_MAX_HEIGHT - 8;
  }
  const maxX = Math.max(DEFINITION_MENU_MARGIN, container.width - DEFINITION_MENU_WIDTH - DEFINITION_MENU_MARGIN);
  const maxY = Math.max(DEFINITION_MENU_MARGIN, container.height - DEFINITION_MENU_MAX_HEIGHT - DEFINITION_MENU_MARGIN);
  return { x: clamp(x, DEFINITION_MENU_MARGIN, maxX), y: clamp(y, DEFINITION_MENU_MARGIN, maxY) };
}
