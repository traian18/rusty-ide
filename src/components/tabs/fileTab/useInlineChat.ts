import { useRef, useState, type MutableRefObject, type RefObject } from "react";
import type { EditorSelectionContext } from "../../../harness/contract";
import type { FileTabData } from "./fileLocation";

const INLINE_CHAT_MARGIN = 12;

export interface InlineChatState {
  context: EditorSelectionContext;
  position: { x: number; y: number };
}

export interface InlineChatControl {
  state: InlineChatState | null;
  sessionId: string;
  /** Adds the Cmd/Ctrl+Enter action that opens inline chat on the selection. */
  register: (editor: any, monaco: any, options: { language: string; onOpen: () => void }) => void;
  close: () => void;
  /** Removes the editor action. */
  dispose: () => void;
}

/** Inline chat belongs to the line, not the caret column: anchored to the
 * editor's leading edge just below the line, using all available width. */
function inlineChatPosition(editor: any, position: unknown, container: HTMLDivElement | null): InlineChatState["position"] {
  const visiblePosition = editor.getScrolledVisiblePosition(position);
  const editorRect = editor.getDomNode()?.getBoundingClientRect();
  const containerRect = container?.getBoundingClientRect();
  const containerHeight = containerRect?.height ?? window.innerHeight;
  const anchorY = (editorRect?.top ?? 0) + (visiblePosition?.top ?? 0) + (visiblePosition?.height ?? 18) - (containerRect?.top ?? 0);
  const y = Math.min(Math.max(INLINE_CHAT_MARGIN, anchorY + 8), Math.max(INLINE_CHAT_MARGIN, containerHeight - 360));
  return { x: INLINE_CHAT_MARGIN, y };
}

function selectionContext(filePath: string, language: string, model: any, selection: any): EditorSelectionContext {
  return {
    filePath,
    language,
    fileContent: model.getValue(),
    selection: {
      text: selection.isEmpty() ? "" : model.getValueInRange(selection),
      startLine: selection.startLineNumber,
      startColumn: selection.startColumn,
      endLine: selection.endLineNumber,
      endColumn: selection.endColumn,
    },
  };
}

export function useInlineChat(
  tab: FileTabData,
  containerRef: RefObject<HTMLDivElement | null>,
  editorRef: MutableRefObject<any>,
): InlineChatControl {
  const [state, setState] = useState<InlineChatState | null>(null);
  const commandRef = useRef<{ dispose: () => void } | null>(null);
  const sessionIdRef = useRef(`inline-chat-${tab.id}-${Date.now()}`);

  const open = (editor: any, language: string, onOpen: () => void) => {
    const model = editor.getModel();
    const selection = editor.getSelection();
    const position = editor.getPosition();
    if (!model || !selection || !position) return;
    const at = inlineChatPosition(editor, position, containerRef.current);
    onOpen();
    setState({ position: at, context: selectionContext(tab.path, language, model, selection) });
  };

  const register: InlineChatControl["register"] = (editor, monaco, { language, onOpen }) => {
    commandRef.current?.dispose();
    commandRef.current = editor.addAction({
      // The id used to be namespaced by editor group, because the same tab
      // could be mounted in two split panes at once. Tab ids are unique now,
      // so there can only ever be one editor per tab.
      id: `rusty.inlineChat.${tab.id}`,
      label: "Open Inline Chat",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => open(editor, language, onOpen),
    });
  };

  return {
    state,
    sessionId: sessionIdRef.current,
    register,
    close: () => {
      setState(null);
      window.setTimeout(() => editorRef.current?.focus(), 0);
    },
    dispose: () => {
      commandRef.current?.dispose();
      commandRef.current = null;
    },
  };
}
