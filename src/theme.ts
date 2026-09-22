export type ThemeAppearance = "light" | "dark";

interface ThemeSeed {
  name: string;
  appearance: ThemeAppearance;
  bgApp: string;
  bgSidebar: string;
  bgHeader: string;
  bgEditor: string;
  bgCanvas: string;
  border: string;
  borderActive: string;
  accent: string;
  accentBg: string;
  textNormal: string;
  textMuted: string;
  textLight: string;
  syntax: {
    comments: string;
    keywords: string;
    strings: string;
    numbers: string;
    functions: string;
    variables: string;
    types: string;
  };
}

export interface ThemeStatusTokens {
  foreground: string;
  background: string;
  border: string;
  solid: string;
  solidForeground: string;
}

export interface AppTheme {
  id: string;
  name: string;
  appearance: ThemeAppearance;
  colors: {
    primary: string;
    primaryForeground: string;
    secondary: string;
    secondaryForeground: string;
    foreground: {
      default: string;
      muted: string;
      strong: string;
      inverse: string;
    };
  };
  workspace: {
    app: string;
    workspace: string;
    sidebar: string;
    header: string;
    panel: string;
    elevated: string;
    sunken: string;
    input: string;
    canvas: string;
    overlay: string;
  };
  borders: {
    default: string;
    subtle: string;
    strong: string;
    focus: string;
  };
  interaction: {
    hover: string;
    active: string;
    selected: string;
    focusRing: string;
    disabled: string;
  };
  status: {
    info: ThemeStatusTokens;
    success: ThemeStatusTokens;
    warning: ThemeStatusTokens;
    danger: ThemeStatusTokens;
  };
  editor: {
    background: string;
    foreground: string;
    lineNumber: string;
    lineNumberActive: string;
    lineHighlight: string;
    lineHighlightBorder: string;
    selection: string;
    inactiveSelection: string;
    selectionHighlight: string;
    cursor: string;
  };
  terminal: {
    background: string;
    foreground: string;
    cursor: string;
    selection: string;
  };
  logs: {
    background: string;
    surface: string;
    header: string;
    foreground: string;
    muted: string;
  };
  syntax: ThemeSeed["syntax"];
  diff: {
    addedBackground: string;
    addedTextBackground: string;
    addedGutter: string;
    removedBackground: string;
    removedTextBackground: string;
    removedGutter: string;
  };
}

const themeSeeds: Record<string, ThemeSeed> = {
  dark: {
    name: "Dark",
    appearance: "dark",
    bgApp: "#121214",
    bgSidebar: "#141416",
    bgHeader: "#141416",
    bgEditor: "#18181b",
    bgCanvas: "#161618",
    border: "#27272a",
    borderActive: "#e07a38",
    accent: "#e07a38",
    accentBg: "rgba(224, 122, 56, 0.12)",
    textNormal: "#e4e4e7",
    textMuted: "#71717a",
    textLight: "#ffffff",
    syntax: {
      comments: "#71717a",
      keywords: "#c084fc",
      strings: "#a3e635",
      numbers: "#fb923c",
      functions: "#60a5fa",
      variables: "#f4f4f5",
      types: "#38bdf8",
    },
  },
  light: {
    name: "Light",
    appearance: "light",
    bgApp: "#f4f4f5",
    bgSidebar: "#ececee",
    bgHeader: "#f4f4f5",
    bgEditor: "#ffffff",
    bgCanvas: "#f4f4f5",
    border: "#e4e4e7",
    borderActive: "#ea580c",
    accent: "#ea580c",
    accentBg: "rgba(234, 88, 12, 0.10)",
    textNormal: "#27272a",
    textMuted: "#71717a",
    textLight: "#09090b",
    syntax: {
      comments: "#a1a1aa",
      keywords: "#9333ea",
      strings: "#16a34a",
      numbers: "#d97706",
      functions: "#2563eb",
      variables: "#dc2626",
      types: "#0891b2",
    },
  },
};

function hexChannels(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  const expanded = normalized.length === 3
    ? normalized.split("").map((part) => part + part).join("")
    : normalized.slice(0, 6);
  return [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16)) as [number, number, number];
}

function withAlpha(hex: string, alpha: number): string {
  const [red, green, blue] = hexChannels(hex);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/** Monaco theme colors only accept hex notation, including #RRGGBBAA for alpha. */
function withHexAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "").slice(0, 6);
  const alphaHex = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${normalized}${alphaHex}`;
}

function mixHex(base: string, mix: string, amount: number): string {
  const baseChannels = hexChannels(base);
  const mixChannels = hexChannels(mix);
  const channels = baseChannels.map((value, index) => Math.round(value + (mixChannels[index] - value) * amount));
  return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function hexToHsl(hex: string): [number, number, number] {
  const [red, green, blue] = hexChannels(hex).map((channel) => channel / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue: number;
  if (max === red) hue = (green - blue) / delta + (green < blue ? 6 : 0);
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  return [hue * 60, saturation, lightness];
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  if (saturation === 0) {
    const gray = Math.round(lightness * 255).toString(16).padStart(2, "0");
    return `#${gray}${gray}${gray}`;
  }
  const hueToChannel = (p: number, q: number, t: number): number => {
    let normalized = t;
    if (normalized < 0) normalized += 1;
    if (normalized > 1) normalized -= 1;
    if (normalized < 1 / 6) return p + (q - p) * 6 * normalized;
    if (normalized < 1 / 2) return q;
    if (normalized < 2 / 3) return p + (q - p) * (2 / 3 - normalized) * 6;
    return p;
  };
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const h = hue / 360;
  const channels = [hueToChannel(p, q, h + 1 / 3), hueToChannel(p, q, h), hueToChannel(p, q, h - 1 / 3)];
  return `#${channels.map((value) => Math.round(value * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** Softens a color's saturation while preserving its hue and lightness — used
 * so selection/highlight colors read as a gentle tint rather than a raw,
 * fully-saturated brand color (some theme accents are quite saturated
 * reds/pinks, which looked harsh as a selection background). */
function desaturate(hex: string, amount: number): string {
  const [hue, saturation, lightness] = hexToHsl(hex);
  return hslToHex(hue, saturation * (1 - amount), lightness);
}

function relativeLuminance(color: string): number {
  const [red, green, blue] = hexChannels(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function contrastRatio(first: string, second: string): number {
  const brightest = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darkest = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (brightest + 0.05) / (darkest + 0.05);
}

function ensureContrast(foreground: string, background: string, minimum: number): string {
  if (contrastRatio(foreground, background) >= minimum) return foreground;
  const target = relativeLuminance(background) > 0.5 ? "#000000" : "#FFFFFF";
  for (let amount = 0.05; amount <= 1; amount += 0.05) {
    const candidate = mixHex(foreground, target, amount);
    if (contrastRatio(candidate, background) >= minimum) return candidate;
  }
  return target;
}

function readableForeground(background: string): string {
  const dark = "#111827";
  const light = "#FFFFFF";
  return contrastRatio(background, dark) >= contrastRatio(background, light) ? dark : light;
}

function statusTokens(foreground: string, appearance: ThemeAppearance): ThemeStatusTokens {
  const solid = appearance === "light" ? foreground : mixHex(foreground, "#000000", 0.45);
  return {
    foreground,
    background: withAlpha(foreground, appearance === "light" ? 0.1 : 0.16),
    border: withAlpha(foreground, appearance === "light" ? 0.28 : 0.38),
    solid,
    solidForeground: readableForeground(solid),
  };
}

function createTheme(id: string, seed: ThemeSeed): AppTheme {
  const appearance = seed.appearance;
  const isLight = appearance === "light";
  const status = isLight
    ? { info: "#0369A1", success: "#047857", warning: "#A15C00", danger: "#BE123C" }
    : { info: "#7DD3FC", success: "#6EE7B7", warning: "#FCD34D", danger: "#FDA4AF" };
  const logBackground = mixHex(seed.bgEditor, isLight ? "#000000" : "#FFFFFF", isLight ? 0.035 : 0.025);
  const mutedForeground = ensureContrast(seed.textMuted, seed.bgApp, 4.5);
  // Selection/highlight surfaces use this instead of the raw accent — some
  // theme accents are highly saturated reds/pinks, which read as a harsh
  // pure-red tint when used at high alpha for a selection background.
  const mutedAccent = desaturate(seed.accent, 0.5);
  const syntax = {
    ...seed.syntax,
    comments: ensureContrast(seed.syntax.comments, seed.bgEditor, 3),
  };

  return {
    id,
    name: seed.name,
    appearance,
    colors: {
      primary: seed.accent,
      primaryForeground: readableForeground(seed.accent),
      secondary: syntax.types,
      secondaryForeground: readableForeground(syntax.types),
      foreground: {
        default: seed.textNormal,
        muted: mutedForeground,
        strong: seed.textLight,
        inverse: isLight ? "#FFFFFF" : "#111827",
      },
    },
    workspace: {
      app: seed.bgApp,
      workspace: seed.bgEditor,
      sidebar: seed.bgSidebar,
      header: seed.bgHeader,
      panel: seed.bgEditor,
      elevated: mixHex(seed.bgSidebar, isLight ? "#FFFFFF" : "#FFFFFF", isLight ? 0.45 : 0.035),
      sunken: mixHex(seed.bgSidebar, "#000000", isLight ? 0.04 : 0.12),
      input: seed.bgApp,
      canvas: seed.bgCanvas,
      overlay: "rgba(0, 0, 0, 0.55)",
    },
    borders: {
      default: seed.border,
      subtle: withAlpha(seed.border, 0.62),
      strong: seed.borderActive,
      focus: seed.accent,
    },
    interaction: {
      hover: withAlpha(seed.accent, isLight ? 0.09 : 0.12),
      active: withAlpha(seed.accent, isLight ? 0.15 : 0.2),
      selected: withAlpha(mutedAccent, isLight ? 0.16 : 0.2),
      focusRing: withAlpha(seed.accent, 0.28),
      disabled: withAlpha(mutedForeground, 0.45),
    },
    status: {
      info: statusTokens(status.info, appearance),
      success: statusTokens(status.success, appearance),
      warning: statusTokens(status.warning, appearance),
      danger: statusTokens(status.danger, appearance),
    },
    editor: {
      background: seed.bgEditor,
      foreground: seed.textNormal,
      lineNumber: mutedForeground,
      lineNumberActive: seed.textLight,
      lineHighlight: mixHex(seed.bgEditor, seed.textNormal, isLight ? 0.045 : 0.065),
      lineHighlightBorder: "#00000000",
      // Monaco's theme colors only accept hex notation (see withHexAlpha) —
      // these previously used withAlpha, which emits an rgba(...) string
      // Monaco can't parse for editor.selectionBackground and friends. That
      // caused it to fall back to a raw/invalid-color render (a solid,
      // fully-opaque red) instead of the intended soft translucent tint,
      // regardless of which theme was active.
      selection: withHexAlpha(seed.textNormal, isLight ? 0.16 : 0.22),
      inactiveSelection: withHexAlpha(seed.textNormal, isLight ? 0.1 : 0.14),
      selectionHighlight: withHexAlpha(seed.textNormal, isLight ? 0.08 : 0.11),
      cursor: ensureContrast(
        mixHex(seed.bgEditor, seed.textNormal, isLight ? 0.55 : 0.48),
        seed.bgEditor,
        3,
      ),
    },
    terminal: {
      background: logBackground,
      foreground: seed.textNormal,
      cursor: seed.accent,
      selection: withAlpha(mutedAccent, isLight ? 0.25 : 0.35),
    },
    logs: {
      background: logBackground,
      surface: mixHex(logBackground, isLight ? "#000000" : "#FFFFFF", isLight ? 0.025 : 0.025),
      header: mixHex(logBackground, isLight ? "#000000" : "#FFFFFF", isLight ? 0.05 : 0.04),
      foreground: seed.textNormal,
      muted: mutedForeground,
    },
    syntax,
    diff: isLight
      ? {
          addedBackground: withHexAlpha("#16A34A", 0.12),
          addedTextBackground: withHexAlpha("#16A34A", 0.2),
          addedGutter: withHexAlpha("#16A34A", 0.42),
          removedBackground: withHexAlpha("#DC2626", 0.1),
          removedTextBackground: withHexAlpha("#DC2626", 0.18),
          removedGutter: withHexAlpha("#DC2626", 0.4),
        }
      : {
          addedBackground: withHexAlpha("#1F9D55", 0.11),
          addedTextBackground: withHexAlpha("#1F9D55", 0.22),
          addedGutter: withHexAlpha("#1F9D55", 0.38),
          removedBackground: withHexAlpha("#E5484D", 0.11),
          removedTextBackground: withHexAlpha("#E5484D", 0.22),
          removedGutter: withHexAlpha("#E5484D", 0.38),
        },
  };
}

export const themes: Record<string, AppTheme> = Object.fromEntries(
  Object.entries(themeSeeds).map(([id, seed]) => [id, createTheme(id, seed)]),
);

export const themeOptions = Object.values(themes).map(({ id, name }) => ({ id, name }));
export const theme = themes.dark;

export function resolveTheme(themeId: string): AppTheme {
  if (themes[themeId]) return themes[themeId];
  if (themeId === "light" || themeId.toLowerCase().includes("light") || themeId === "sepia") {
    return themes.light;
  }
  return themes.dark;
}

const cssVariables = (themeDefinition: AppTheme): Record<string, string> => ({
  "--color-primary": themeDefinition.colors.primary,
  "--color-primary-foreground": themeDefinition.colors.primaryForeground,
  "--color-secondary": themeDefinition.colors.secondary,
  "--color-secondary-foreground": themeDefinition.colors.secondaryForeground,
  "--color-secondary-bg": withAlpha(themeDefinition.colors.secondary, themeDefinition.appearance === "light" ? 0.1 : 0.16),
  "--color-secondary-border": withAlpha(themeDefinition.colors.secondary, 0.35),
  "--color-fg-default": themeDefinition.colors.foreground.default,
  "--color-fg-muted": themeDefinition.colors.foreground.muted,
  "--color-fg-strong": themeDefinition.colors.foreground.strong,
  "--color-fg-inverse": themeDefinition.colors.foreground.inverse,
  "--color-surface-app": themeDefinition.workspace.app,
  "--color-surface-workspace": themeDefinition.workspace.workspace,
  "--color-surface-sidebar": themeDefinition.workspace.sidebar,
  "--color-surface-header": themeDefinition.workspace.header,
  "--color-surface-panel": themeDefinition.workspace.panel,
  "--color-surface-elevated": themeDefinition.workspace.elevated,
  "--color-surface-sunken": themeDefinition.workspace.sunken,
  "--color-surface-input": themeDefinition.workspace.input,
  "--color-surface-canvas": themeDefinition.workspace.canvas,
  "--color-surface-overlay": themeDefinition.workspace.overlay,
  "--color-border-default": themeDefinition.borders.default,
  "--color-border-subtle": themeDefinition.borders.subtle,
  "--color-border-strong": themeDefinition.borders.strong,
  "--color-border-focus": themeDefinition.borders.focus,
  "--color-interaction-hover": themeDefinition.interaction.hover,
  "--color-interaction-active": themeDefinition.interaction.active,
  "--color-interaction-selected": themeDefinition.interaction.selected,
  "--color-focus-ring": themeDefinition.interaction.focusRing,
  "--color-disabled": themeDefinition.interaction.disabled,
  "--color-log-background": themeDefinition.logs.background,
  "--color-log-surface": themeDefinition.logs.surface,
  "--color-log-header": themeDefinition.logs.header,
  "--color-log-foreground": themeDefinition.logs.foreground,
  "--color-log-muted": themeDefinition.logs.muted,
  "--color-editor-background": themeDefinition.editor.background,
  "--color-terminal-background": themeDefinition.terminal.background,
  "--color-status-info": themeDefinition.status.info.foreground,
  "--color-status-info-bg": themeDefinition.status.info.background,
  "--color-status-info-border": themeDefinition.status.info.border,
  "--color-status-info-solid": themeDefinition.status.info.solid,
  "--color-status-info-solid-foreground": themeDefinition.status.info.solidForeground,
  "--color-status-success": themeDefinition.status.success.foreground,
  "--color-status-success-bg": themeDefinition.status.success.background,
  "--color-status-success-border": themeDefinition.status.success.border,
  "--color-status-success-solid": themeDefinition.status.success.solid,
  "--color-status-success-solid-foreground": themeDefinition.status.success.solidForeground,
  "--color-status-warning": themeDefinition.status.warning.foreground,
  "--color-status-warning-bg": themeDefinition.status.warning.background,
  "--color-status-warning-border": themeDefinition.status.warning.border,
  "--color-status-warning-solid": themeDefinition.status.warning.solid,
  "--color-status-warning-solid-foreground": themeDefinition.status.warning.solidForeground,
  "--color-status-danger": themeDefinition.status.danger.foreground,
  "--color-status-danger-bg": themeDefinition.status.danger.background,
  "--color-status-danger-border": themeDefinition.status.danger.border,
  "--color-status-danger-solid": themeDefinition.status.danger.solid,
  "--color-status-danger-solid-foreground": themeDefinition.status.danger.solidForeground,
  "--syntax-comment": themeDefinition.syntax.comments,
  "--syntax-keyword": themeDefinition.syntax.keywords,
  "--syntax-string": themeDefinition.syntax.strings,
  "--syntax-number": themeDefinition.syntax.numbers,
  "--syntax-function": themeDefinition.syntax.functions,
  "--syntax-variable": themeDefinition.syntax.variables,
  "--syntax-type": themeDefinition.syntax.types,

  // Compatibility aliases while existing components move to semantic tokens.
  "--bg-app": themeDefinition.workspace.app,
  "--bg-sidebar": themeDefinition.workspace.sidebar,
  "--bg-header": themeDefinition.workspace.header,
  "--bg-editor": themeDefinition.editor.background,
  "--bg-canvas": themeDefinition.workspace.canvas,
  "--border-color": themeDefinition.borders.default,
  "--border-active": themeDefinition.borders.strong,
  "--text-normal": themeDefinition.colors.foreground.default,
  "--text-muted": themeDefinition.colors.foreground.muted,
  "--text-light": themeDefinition.colors.foreground.strong,
  "--text-color": themeDefinition.colors.foreground.strong,
  "--accent-color": themeDefinition.colors.primary,
  "--accent-bg": themeDefinition.interaction.selected,
});

/** Applies every CSS-consumable token and browser-level appearance hint. */
export function applyThemeProperties(themeDefinition: AppTheme) {
  const root = document.documentElement;
  Object.entries(cssVariables(themeDefinition)).forEach(([property, value]) => root.style.setProperty(property, value));
  root.dataset.theme = themeDefinition.id;
  root.dataset.appearance = themeDefinition.appearance;
  root.style.colorScheme = themeDefinition.appearance;

  const favicon = document.querySelector("link[rel='icon']");
  if (favicon) {
    favicon.setAttribute("href", themeDefinition.appearance === "light" ? "/rusty-light.png" : "/rusty-dark.png");
    favicon.setAttribute("type", "image/png");
  }
}

/** Registers the active application theme with Monaco. */
export function defineMonacoTheme(monaco: any, t: AppTheme) {
  monaco.editor.defineTheme("rusty-custom-theme", {
    base: t.appearance === "light" ? "vs" : "vs-dark",
    inherit: true,
    semanticHighlighting: true,
    rules: [
      { token: "", foreground: t.editor.foreground.replace("#", "") },
      { token: "comment", foreground: t.syntax.comments.replace("#", ""), fontStyle: "italic" },
      { token: "keyword", foreground: t.syntax.keywords.replace("#", "") },
      { token: "keyword.control", foreground: t.syntax.keywords.replace("#", "") },
      { token: "operator", foreground: t.syntax.keywords.replace("#", "") },
      { token: "string", foreground: t.syntax.strings.replace("#", "") },
      { token: "string.escape", foreground: t.syntax.numbers.replace("#", "") },
      { token: "number", foreground: t.syntax.numbers.replace("#", "") },
      { token: "regexp", foreground: t.syntax.strings.replace("#", "") },
      { token: "type", foreground: t.syntax.types.replace("#", "") },
      { token: "class", foreground: t.syntax.types.replace("#", "") },
      { token: "function", foreground: t.syntax.functions.replace("#", "") },
      { token: "function.declaration", foreground: t.syntax.functions.replace("#", "") },
      { token: "variable", foreground: t.syntax.variables.replace("#", "") },
      { token: "identifier", foreground: t.syntax.variables.replace("#", "") },
    ],
    colors: {
      "focusBorder": t.editor.lineHighlightBorder,
      "contrastActiveBorder": t.editor.lineHighlightBorder,
      "editor.background": t.editor.background,
      "editor.foreground": t.editor.foreground,
      "editorLineNumber.foreground": t.editor.lineNumber,
      "editorLineNumber.activeForeground": t.editor.lineNumberActive,
      "editor.lineHighlightBackground": t.editor.lineHighlight,
      "editor.lineHighlightBorder": t.editor.lineHighlightBorder,
      "editor.selectionBackground": t.editor.selection,
      "editor.inactiveSelectionBackground": t.editor.inactiveSelection,
      "editor.selectionHighlightBackground": t.editor.selectionHighlight,
      "editor.selectionHighlightBorder": t.editor.lineHighlightBorder,
      "editor.wordHighlightBorder": t.editor.lineHighlightBorder,
      "editor.wordHighlightStrongBorder": t.editor.lineHighlightBorder,
      "editor.rangeHighlightBorder": t.editor.lineHighlightBorder,
      "editorBracketMatch.border": t.editor.lineHighlightBorder,
      "editor.snippetTabstopHighlightBorder": t.editor.lineHighlightBorder,
      "editor.snippetFinalTabstopHighlightBorder": t.editor.lineHighlightBorder,
      "editorOverviewRuler.selectionHighlightForeground": t.editor.lineHighlightBorder,
      "editorCursor.foreground": t.editor.cursor,
      "diffEditor.insertedTextBackground": t.diff.addedTextBackground,
      "diffEditor.removedTextBackground": t.diff.removedTextBackground,
      "diffEditor.insertedLineBackground": t.diff.addedBackground,
      "diffEditor.removedLineBackground": t.diff.removedBackground,
      "diffEditorGutter.insertedLineBackground": t.diff.addedGutter,
      "diffEditorGutter.removedLineBackground": t.diff.removedGutter,
    },
  });
}
