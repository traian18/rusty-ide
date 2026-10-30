export { editorClient, createEditorClient, type EditorClient, type FileOpenSafety } from "./client";
export { monacoLineHeight, createMonacoEditorOptions, createMonacoDiffOptions } from "./monacoOptions";
export { isImageFile, getImageMimeType } from "./service/imageFile";
export {
  LSP_SETTINGS_KEYS,
  getLspKeyFromMonacoId,
  isLspMonacoId,
  resolveLanguage,
  getMonacoLanguageId,
  getLspKeyFromPath,
  type IconKey,
  type LanguageRule,
} from "./service/languageRegistry";
export { disableBuiltInTsDiagnostics } from "./service/monacoDiagnostics";
export { EDITOR_FILE_SAFETY_DEFAULTS, loadEditorFileSafetyPreferences, saveEditorFileSafetyPreferences, type EditorFileSafetyPreferences } from "./service/editorFileSafety";
