import { loader } from "@monaco-editor/react";
import { useWorkspaceStore } from "../../../store";
import { themes, defineMonacoTheme } from "../../../theme";
import { disableBuiltInTsDiagnostics } from "../service/monacoDiagnostics";

let registered = false;

/**
 * Registers the custom Monaco theme once. It runs on the first file tab render, not when the
 * module loads, so importing the editor's UI index has no side effects.
 */
export function registerMonacoTheme(): void {
  if (registered) return;
  registered = true;
  loader.init().then((monaco) => {
    const activeThemeId = useWorkspaceStore.getState().activeThemeId;
    const activeTheme = themes[activeThemeId] || themes.dark;
    defineMonacoTheme(monaco, activeTheme);
    // Monaco's built-in TS worker has no awareness of this project's actual
    // tsconfig, so left enabled it flags false-positive module/JSX errors --
    // see monacoDiagnostics.ts's own doc comment.
    disableBuiltInTsDiagnostics(monaco);
  }).catch((error) => {
    console.warn("Failed to initialize Monaco for file tabs:", error);
  });
}
