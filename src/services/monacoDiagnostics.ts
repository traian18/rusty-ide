// ============================================================
// monacoDiagnostics.ts — disables Monaco's own built-in TypeScript/
// JavaScript diagnostics worker.
//
// Extracted from the now-removed monacoLspBinding.ts (LSP-over-sidecar
// editor integration, deleted per the user's own direction while removing
// the sidecar -- it never worked in practice, gated permanently off by
// FileTab.tsx's own `LSP_EDITOR_ENABLED = false`; LSP support may return
// later, but scoped to model-facing tools only, not this editor UI
// integration). This one function survives that removal on its own merits:
// Monaco's built-in worker has no awareness of this project's tsconfig,
// module resolution, or file system, so left enabled it produces
// false-positive "cannot find module"/"cannot use JSX" errors on any file
// with project-relative imports -- independent of whether a real language
// server is attached.
// ============================================================

let disabled = false;

export function disableBuiltInTsDiagnostics(monacoInstance?: any) {
  if (disabled) return;
  const monaco = monacoInstance || (window as any).monaco;
  if (!monaco?.languages?.typescript) return;
  disabled = true;
  try {
    monaco.languages.typescript.typescriptDefaults?.setDiagnosticsOptions?.({
      noSemanticValidation: true,
      noSyntaxValidation: true,
    });
    monaco.languages.typescript.javascriptDefaults?.setDiagnosticsOptions?.({
      noSemanticValidation: true,
      noSyntaxValidation: true,
    });
  } catch {
    /* older monaco builds may not expose these */
  }
}
