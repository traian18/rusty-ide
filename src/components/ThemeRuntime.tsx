import { useEffect } from "react";
import { loader } from "@monaco-editor/react";
import { useWorkspaceStore } from "../store";
import { applyThemeProperties, defineMonacoTheme, resolveTheme } from "../theme";
import { disableBuiltInTsDiagnostics } from "../services/monacoDiagnostics";

/** Keeps CSS and non-CSS renderers synchronized with the persisted theme id. */
export function ThemeRuntime() {
  const activeThemeId = useWorkspaceStore((state) => state.activeThemeId);

  useEffect(() => {
    const theme = resolveTheme(activeThemeId);
    applyThemeProperties(theme);

    loader.init().then((monaco) => {
      defineMonacoTheme(monaco, theme);
      monaco.editor.setTheme("rusty-custom-theme");
      // Monaco's built-in TS worker has no awareness of this project's
      // actual tsconfig, so left enabled it flags false-positive module/JSX
      // errors -- see monacoDiagnostics.ts's own doc comment.
      disableBuiltInTsDiagnostics(monaco);
    }).catch((error) => {
      console.warn("Failed to propagate theme to Monaco:", error);
    });
  }, [activeThemeId]);

  return null;
}
