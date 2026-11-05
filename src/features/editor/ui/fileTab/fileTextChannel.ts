/**
 * Keeps the tabs of one file on the same text. Editors that show the file
 * already share its Monaco model; this is what also reaches a tab with no
 * editor, such as a Markdown preview beside the source. A model outlives its
 * editor while its tab is hidden, and the editor wrapper reuses it as it finds
 * it, so text from outside the editors has to go into the model here.
 */

type TextListener = (text: string) => void;

const listeners = new Map<string, Set<TextListener>>();
let receiving = false;

/** Hears every text change of the file at `modelUri`. Returns an unsubscribe function. */
export function onFileText(modelUri: string, listener: TextListener): () => void {
  const fileListeners = listeners.get(modelUri) ?? new Set<TextListener>();
  fileListeners.add(listener);
  listeners.set(modelUri, fileListeners);
  return () => {
    fileListeners.delete(listener);
    if (fileListeners.size === 0) listeners.delete(modelUri);
  };
}

export function shareFileText(modelUri: string, text: string): void {
  listeners.get(modelUri)?.forEach((listener) => listener(text));
}

/** The file's Monaco model, when one exists. */
export function fileModel(modelUri: string): any {
  const monaco = (window as any).monaco;
  return monaco?.editor.getModel(monaco.Uri.parse(modelUri)) ?? null;
}

/** Whether a model is taking text from outside. Each editor on it reports that
 * as a change; saving the report could replace a newer file with this text. */
export function isReceivingFileText(): boolean {
  return receiving;
}

/** How many characters match at each end, keeping surrogate pairs whole. */
function matchingEnds(before: string, after: string): { start: number; end: number } {
  const shorter = Math.min(before.length, after.length);
  let start = 0;
  while (start < shorter && before[start] === after[start]) start += 1;
  let end = 0;
  while (end < shorter - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end += 1;
  if (/[\uD800-\uDBFF]/.test(before.charAt(start - 1))) start -= 1;
  if (/[\uDC00-\uDFFF]/.test(before.charAt(before.length - end))) end -= 1;
  return { start, end };
}

/** Puts text that came from outside the editors, such as the file on disk, in
 * every tab of the file. It replaces only what differs, so cursors elsewhere
 * in the file stay put, and it can be undone. */
export function receiveFileText(modelUri: string, text: string): void {
  const model = fileModel(modelUri);
  if (!model) {
    shareFileText(modelUri, text);
    return;
  }
  // A model settles on one line ending, so compare what it would hold.
  const after = text.replace(/\r\n|\r|\n/g, model.getEOL());
  const before: string = model.getValue();
  if (before !== after) {
    const { start, end } = matchingEnds(before, after);
    const from = model.getPositionAt(start);
    const to = model.getPositionAt(before.length - end);
    const range = { startLineNumber: from.lineNumber, startColumn: from.column, endLineNumber: to.lineNumber, endColumn: to.column };
    receiving = true;
    try {
      model.pushStackElement();
      model.pushEditOperations(null, [{ range, text: after.slice(start, after.length - end) }], () => null);
      model.pushStackElement();
    } finally {
      receiving = false;
    }
  }
  shareFileText(modelUri, after);
}
