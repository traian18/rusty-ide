import React from "react";
import { ReactLogo, TypeScriptLogo, JavaScriptLogo, PythonLogo, JavaLogo, HtmlLogo, CssLogo, RustLogo, JsonLogo, MarkdownLogo, SqlLogo, GitLogo, DockerLogo, GoLogo, PhpLogo, RubyLogo, CppLogo, CLogo, ShellLogo, EnvLogo, ConfigLogo, ImageLogo, DefaultLogo, KotlinLogo, ScalaLogo, SwiftLogo, FSharpLogo, ObjectiveCLogo, DartLogo, RLogo, PowerShellLogo, HclLogo, GraphqlLogo, ProtobufLogo } from "./techLogos";
import { getMonacoLanguageId, resolveLanguage, type IconKey } from "../service/languageRegistry";

// --- 2. Filetype Details Mapping ---

export interface FileTypeDetails {
  icon: React.FC<{ size: number; className?: string }>;
  color: string;
  language: string;
}

/**
 * Returns custom SVG icon component, CSS helper class, and Monaco language code based on filename extension.
 *
 * The `language` field is sourced from `languageRegistry.getMonacoLanguageId`
 * so that the Monaco model language id and the LSP server key can never
 * drift apart (see src/services/languageRegistry.ts). Icon selection stays
 * here for now -- PR 6 commit 2 folds it onto the same registry too.
 */
export const getFileTypeDetails = (fileName: string): FileTypeDetails => {
  return { icon: iconForFile(fileName), color: "", language: getMonacoLanguageId(fileName) };
};

/**
 * IconKey -> component (REFACTOR_PLAN.md PR 6 commit 2). This is the only
 * place that still knows about the actual logo components -- icon
 * *selection* (which extension/filename gets which key) now lives in
 * languageRegistry.ts's `RULES`, not here, so the two can never drift back
 * apart the way fileTypeService's icon switch and lspLanguage's id switch
 * once did.
 */
const ICONS: Record<IconKey, React.FC<{ size: number; className?: string }>> = {
  react: ReactLogo,
  typescript: TypeScriptLogo,
  javascript: JavaScriptLogo,
  html: HtmlLogo,
  css: CssLogo,
  json: JsonLogo,
  markdown: MarkdownLogo,
  python: PythonLogo,
  java: JavaLogo,
  rust: RustLogo,
  go: GoLogo,
  ruby: RubyLogo,
  php: PhpLogo,
  cpp: CppLogo,
  c: CLogo,
  sql: SqlLogo,
  shell: ShellLogo,
  config: ConfigLogo,
  env: EnvLogo,
  git: GitLogo,
  docker: DockerLogo,
  kotlin: KotlinLogo,
  scala: ScalaLogo,
  swift: SwiftLogo,
  fsharp: FSharpLogo,
  objectivec: ObjectiveCLogo,
  dart: DartLogo,
  r: RLogo,
  powershell: PowerShellLogo,
  hcl: HclLogo,
  graphql: GraphqlLogo,
  protobuf: ProtobufLogo,
  image: ImageLogo,
  default: DefaultLogo,
};

/** Resolve the technology logo for a file name (used by FileIcon + getFileTypeDetails). */
function iconForFile(fileName: string): React.FC<{ size: number; className?: string }> {
  return ICONS[resolveLanguage(fileName).iconKey];
}

interface FileIconProps {
  fileName: string;
  size?: number;
  className?: string;
}

/**
 * Visual Icon Component for files, displaying the exact technology logo
 */
export const FileIcon: React.FC<FileIconProps> = ({ fileName, size = 14, className = "" }) => {
  const { icon: Icon } = getFileTypeDetails(fileName);
  return <Icon size={size} className={className} />;
};
