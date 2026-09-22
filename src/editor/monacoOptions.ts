import type { editor } from "monaco-editor";

type EditorOverrides = Omit<editor.IStandaloneEditorConstructionOptions, "fontSize" | "lineHeight">;
type DiffOverrides = Omit<editor.IStandaloneDiffEditorConstructionOptions, "fontSize" | "lineHeight">;

export function monacoLineHeight(fontSize: number): number {
  return Math.round(fontSize * 1.5);
}

export function createMonacoEditorOptions(
  editorFontSize: number,
  overrides: EditorOverrides = {},
): editor.IStandaloneEditorConstructionOptions {
  return {
    ...overrides,
    fontSize: editorFontSize,
    lineHeight: monacoLineHeight(editorFontSize),
  };
}

export function createMonacoDiffOptions(
  editorFontSize: number,
  overrides: DiffOverrides = {},
): editor.IStandaloneDiffEditorConstructionOptions {
  return {
    ...overrides,
    fontSize: editorFontSize,
    lineHeight: monacoLineHeight(editorFontSize),
  };
}
