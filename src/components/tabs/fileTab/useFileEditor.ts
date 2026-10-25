import { useEffect, useRef, type MutableRefObject } from "react";
import { noteCursor, registerEditor, unregisterEditor } from "../../../navigation/navigationHistory";
import { useWorkspaceStore } from "../../../store";
import type { FileLocation, FileTabData } from "./fileLocation";
import type { AutoSave } from "./useAutoSave";
import type { DefinitionLookup } from "./useDefinitionLookup";
import type { GitBlame } from "./useGitBlame";
import type { GitGutter } from "./useGitGutter";
import type { InlineChatControl } from "./useInlineChat";
import { isGutterClick, isModifierClick } from "./definitionSearch";

export interface FileEditorParts {
  tab: FileTabData;
  isActive: boolean;
  location: FileLocation;
  /** The editor's language when it mounts, for inline chat's context. */
  language: string;
  blame: GitBlame;
  gutter: GitGutter;
  definitions: DefinitionLookup;
  inlineChat: InlineChatControl;
  autoSave: AutoSave;
}

function locationOf(tab: FileTabData, position: { lineNumber: number; column: number }) {
  return { path: tab.path, vfsTabId: tab.vfsTabId, line: position.lineNumber, column: position.column };
}

function scrollToLine(editor: any, lineNum: number): void {
  if (!editor || !lineNum) return;
  editor.revealLineInCenter(lineNum);
  editor.setPosition({ lineNumber: lineNum, column: 1 });
  editor.focus();
}

/** Disposes the file's Monaco model on the next tick, unless the tab is
 * still open (moving a tab between panes keeps its model). */
function disposeModelWhenClosed(modelUri: string, tabId: string): void {
  window.setTimeout(() => {
    const monaco = (window as any).monaco;
    if (!monaco) return;
    const model = monaco.editor.getModel(monaco.Uri.parse(modelUri));
    const stillOpenElsewhere = useWorkspaceStore.getState().tabs.some((t) => t.type === "file" && t.id === tabId);
    if (model && !model.isDisposed?.() && !stillOpenElsewhere) model.dispose();
  }, 0);
}

/** Wires the Monaco editor for a file tab: what mounting it sets up, keeping
 * it laid out and on the tab's line, and releasing it when the file
 * changes. Returns the editor's onMount handler. */
export function useFileEditor(editorRef: MutableRefObject<any>, parts: FileEditorParts): (editor: any, monaco: any) => void {
  const { tab, isActive, location } = parts;
  const tabRef = useRef(tab);
  tabRef.current = tab;

  // Trigger editor layout when tab becomes active
  useEffect(() => {
    if (isActive && editorRef.current) {
      setTimeout(() => editorRef.current?.layout(), 50);
    }
  }, [isActive]);

  // Arriving in a file is a place Navigate Back can return to.
  useEffect(() => {
    const position = isActive ? editorRef.current?.getPosition?.() : null;
    if (position) noteCursor(locationOf(tab, position));
  }, [isActive]);

  useEffect(() => () => unregisterEditor(tab.id, editorRef.current), [tab.id]);

  useEffect(() => {
    if (editorRef.current && tab.line) scrollToLine(editorRef.current, tab.line);
  }, [tab.line]);

  useEffect(() => {
    if (location.isImage) return undefined;
    return () => {
      parts.autoSave.cancel();
      parts.inlineChat.dispose();
      disposeModelWhenClosed(location.monacoModelUri, tab.id);
    };
  }, [tab.path, tab.id, tab.vfsTabId, location.canvasTabId, location.isImage, location.monacoModelUri]);

  return (editor, monaco) => {
    editorRef.current = editor;
    registerEditor(tab.id, editor);
    // Where the cursor goes feeds Navigate Back/Forward, while this tab is the active one.
    editor.onDidChangeCursorPosition?.((e: any) => {
      const current = tabRef.current;
      if (useWorkspaceStore.getState().activeTabId === current.id) noteCursor(locationOf(current, e.position));
    });
    parts.gutter.attach();
    if (monaco) parts.inlineChat.register(editor, monaco, { language: parts.language, onOpen: parts.definitions.close });

    // Cmd/Ctrl-click looks up a definition; any other click closes the menu,
    // and a click on the line numbers gutter toggles blame.
    editor.onMouseDown(async (e: any) => {
      if (await parts.definitions.lookup(editor, e)) return;
      if (!isModifierClick(e?.event?.browserEvent)) parts.definitions.close();
      if (isGutterClick(e.target)) parts.blame.toggle();
    });

    setTimeout(() => {
      editor.layout();
      if (tab.line) scrollToLine(editor, tab.line);
    }, 50);
  };
}
