import { useCallback, useState } from "react";

const FIND_CONTROLLER = "editor.contrib.findController";

export interface FindWidgetOffset {
  /** How far the find widget reaches into the editor's top edge while it is open, in pixels. */
  offset: number;
  /** Starts following the editor's find widget; call when the editor mounts. */
  attach: (editor: any) => void;
}

/** The open find widget's height: its own box, so the replace row is counted too. */
function openHeight(editor: any): number {
  const state = editor.getContribution?.(FIND_CONTROLLER)?.getState?.();
  if (!state?.isRevealed) return 0;
  const widget = editor.getDomNode?.()?.querySelector?.(".find-widget") as HTMLElement | null;
  return widget?.offsetHeight ?? 0;
}

/** Follows the Monaco find widget, so the file tab's toolbar can move out of its way. */
export function useFindWidgetOffset(): FindWidgetOffset {
  const [offset, setOffset] = useState(0);
  // The subscription lives as long as the editor, not as an effect: StrictMode runs an effect's
  // cleanup once right after mounting, and the editor mounts only once, so it would not attach again.
  const attach = useCallback((editor: any) => {
    const state = editor.getContribution?.(FIND_CONTROLLER)?.getState?.();
    if (!state?.onFindReplaceStateChange) return;
    // The widget's classes change with the state, so it is measured on the next frame.
    const subscription = state.onFindReplaceStateChange(() => {
      requestAnimationFrame(() => setOffset(openHeight(editor)));
    });
    editor.onDidDispose?.(() => subscription.dispose());
  }, []);

  return { offset, attach };
}
