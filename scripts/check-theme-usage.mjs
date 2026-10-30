import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const sourceRoot = new URL("../src", import.meta.url).pathname;
const sourceExtensions = new Set([".css", ".ts", ".tsx"]);
const allowedFixedColorFiles = new Set([
  "features/editor/ui/fileTypeService.tsx", // Official language and tool artwork.
  "features/canvas/ui/nodes/sticky/StickyNode.tsx", // User-selectable sticky-note ink.
  "features/canvas/ui/nodes/sticky/stickyColors.ts", // User-selectable sticky-note paper.
  "styles/categoricalColors.ts", // The shared palette for telling categories apart.
]);
const forbidden = [
  { pattern: /\bbg-black(?:\/\d+)?\b/, message: "use a semantic surface token" },
  { pattern: /\b(?:text|bg|border)-zinc-\d+\b/, message: "use foreground, surface, or border tokens" },
  { pattern: /\bprose-invert\b/, message: "Markdown appearance must follow the active theme" },
  { pattern: /highlight\.js\/styles\/[^\"']*dark/i, message: "use the tokenized highlight.js rules" },
];
const semanticCssModules = [
  /^App\.module\.css$/,
  /^app\/shell\/(?:AppBootstrapBoundary|AppShell|StartupDegradedBanner)\.module\.css$/,
  /^app\/workspace\/(?:MainWorkspace|TabStrip|TabOutlet)\.module\.css$/,
  /^app\/navigation\/NavigationRail\.module\.css$/,
  /^app\/drawer\/(?:ContextDrawer|DrawerSkeleton)\.module\.css$/,
  /^app\/(?:Header)\.module\.css$/,
  /^features\/terminal\/ui\/(?:TerminalPanel|LocalTerminal)\.module\.css$/,
  /^features\/explorer\/ui\/(?:SearchPalette|CreateDialog|MoveDialog)\.module\.css$/,
  /^features\/(?:settings|updates|editor|providers)\/ui\/(?:AppearanceSettings|EditorFileSafetySettings|KeyboardShortcutsSettings|ManagedAuthSettings|SecretStorageStatus|StorageSettings|TypographySettings|UpdateSettings|WebSearchSettings)\.module\.css$/,
  /^features\/settings\/ui\/SettingsTab\.module\.css$/,
  /^features\/workflows\/ui\/.*\.module\.css$/,
  /^features\/architecture\/ui\/.*\.module\.css$/,
  /^lib\/ui\/(?:Button|FormControls|NumberStepper|Modal|IconButton|Callout|Tooltip)\//,
  /^features\/agent-chat\/ui\/(?:Chat|ChatInput|SubagentActivityPanel)\.module\.css$/,
  /^lib\/ui\/(?:MarkdownRenderer|CustomSelect)\.module\.css$/,
  /^lib\/ui\/DiffViewToggle\.module\.css$/,
  /^features\/canvas\/ui\/nodes\/TaskNode\.module\.css$/,
  /^features\/canvas\/ui\/nodes\/McpNode\.module\.css$/,
  /^features\/canvas\/ui\/nodes\/boundary\/BoundaryNode\.module\.css$/,
  /^features\/permissions\/ui\/CommandPermissionDialog\.module\.css$/,
];
const semanticModuleForbidden = [
  {
    pattern: /var\(--(?:bg|text|accent|border)(?:-|_)/,
    message: "migrated CSS Modules must use the canonical --color-* contract",
  },
  {
    pattern: /(?:^|[^\w-])(?:#(?:[\da-f]{3,8})|rgba?\(|hsla?\()/i,
    message: "migrated CSS Modules must not contain raw colors",
  },
  {
    pattern: /font-size:\s*\d+(?:\.\d+)?px\b/,
    message: "migrated CSS Modules must use a typography role",
  },
];
const migratedJsxFiles = new Set([
  "App.tsx",
  "app/shell/AppBootstrapBoundary.view.tsx",
  "app/shell/StartupDegradedBanner.tsx",
  "app/shell/AppShell.view.tsx",
  "app/workspace/MainWorkspace.tsx",
  "app/workspace/TabOutlet.tsx",
  "app/workspace/TabStrip.view.tsx",
  "app/navigation/NavigationRail.view.tsx",
  "app/drawer/ContextDrawer.view.tsx",
  "app/drawer/DrawerSkeleton.tsx",
  "app/Header.view.tsx",
  "features/terminal/ui/TerminalPanel.tsx",
  "features/terminal/ui/LocalTerminal.tsx",
  "features/explorer/ui/SearchPaletteView.tsx",
  "lib/ui/CustomSelect.view.tsx",
  "lib/ui/DiffViewToggle.tsx",
  "lib/ui/Tooltip/Tooltip.tsx",
  "features/canvas/ui/nodes/TaskNode.tsx",
  "features/canvas/ui/nodes/McpNode.tsx",
  "features/canvas/ui/nodes/boundary/BoundaryNode.tsx",
  "features/canvas/ui/nodes/sticky/StickyNode.tsx",
  "lib/ui/ConfirmModal.tsx",
  "features/explorer/ui/CreateDialog.tsx",
  "features/explorer/ui/MoveDialog.tsx",
  "features/permissions/ui/CommandPermissionDialog.tsx",
  "features/mcp/ui/McpIntegrationModal.tsx",
  "features/workflows/ui/BehaviorsTab.tsx",
  "features/workflows/ui/BehaviorCanvases.tsx",
  "features/workflows/ui/BehaviorNodes.tsx",
  "features/workflows/ui/ProfileInspector.tsx",
  "features/workflows/ui/WorkflowInspector.tsx",
  "features/workflows/ui/InspectorFields.tsx",
  "features/workflows/ui/AgentWorkflowBar.tsx",
]);

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const violations = [];
for (const path of walk(sourceRoot)) {
  if (!sourceExtensions.has(extname(path))) continue;
  const displayPath = relative(sourceRoot, path);
  if (allowedFixedColorFiles.has(displayPath)) continue;
  const lines = readFileSync(path, "utf8").split("\n");
  lines.forEach((line, index) => {
    forbidden.forEach(({ pattern, message }) => {
      if (pattern.test(line)) violations.push(`${displayPath}:${index + 1}: ${message}`);
    });
    if (semanticCssModules.some((pattern) => pattern.test(displayPath))) {
      semanticModuleForbidden.forEach(({ pattern, message }) => {
        if (pattern.test(line)) violations.push(`${displayPath}:${index + 1}: ${message}`);
      });
    }
    if (migratedJsxFiles.has(displayPath) && /className\s*=\s*["']/.test(line)) {
      violations.push(`${displayPath}:${index + 1}: migrated components must keep presentation in their CSS Module`);
    }
  });
}

const protectedMonacoTypographyConsumers = [
  "features/editor/ui/FileTab.tsx",
  "features/git/ui/GitDiffTab.tsx",
  "features/workflows/ui/TaskTab.tsx",
  "features/canvas/ui/edgeinspector/components/EdgeDiffTabContent.tsx",
  "features/canvas/ui/sidepane/components/DiffTabContent.tsx",
];

for (const displayPath of protectedMonacoTypographyConsumers) {
  const path = join(sourceRoot, displayPath);
  readFileSync(path, "utf8").split("\n").forEach((line, index) => {
    if (/fontSize:\s*\d/.test(line)) {
      violations.push(`${displayPath}:${index + 1}: Monaco typography must use src/editor/monacoOptions.ts`);
    }
  });
}

if (violations.length > 0) {
  console.error(`Theme usage check failed:\n${violations.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("Theme usage check passed.");
}
