export interface TypographyPreferences {
  editorFontSize: number;
  chatFontSize: number;
  ideFontSize: number;
}

export type TypographyPreferenceKey = keyof TypographyPreferences;

export const TYPOGRAPHY_STORAGE_KEY = "rusty_typography_preferences";
export const TYPOGRAPHY_STORAGE_VERSION = 1;

export const TYPOGRAPHY_DEFAULTS: TypographyPreferences = {
  editorFontSize: 12,
  chatFontSize: 13,
  ideFontSize: 12,
};

export const TYPOGRAPHY_LIMITS: Record<
  TypographyPreferenceKey,
  { min: number; max: number; step: number }
> = {
  editorFontSize: { min: 10, max: 24, step: 1 },
  chatFontSize: { min: 11, max: 22, step: 1 },
  ideFontSize: { min: 10, max: 18, step: 1 },
};

function clampPreference(key: TypographyPreferenceKey, value: unknown): number {
  const fallback = TYPOGRAPHY_DEFAULTS[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const { min, max } = TYPOGRAPHY_LIMITS[key];
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function normalizeTypographyPreferences(value: unknown): TypographyPreferences {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const stored = record.preferences && typeof record.preferences === "object"
    ? record.preferences as Record<string, unknown>
    : record;

  return {
    editorFontSize: clampPreference("editorFontSize", stored.editorFontSize),
    chatFontSize: clampPreference("chatFontSize", stored.chatFontSize),
    ideFontSize: clampPreference("ideFontSize", stored.ideFontSize),
  };
}

export function loadTypographyPreferences(): TypographyPreferences {
  if (typeof localStorage === "undefined") return { ...TYPOGRAPHY_DEFAULTS };
  try {
    const raw = localStorage.getItem(TYPOGRAPHY_STORAGE_KEY);
    return raw ? normalizeTypographyPreferences(JSON.parse(raw)) : { ...TYPOGRAPHY_DEFAULTS };
  } catch {
    return { ...TYPOGRAPHY_DEFAULTS };
  }
}

export function saveTypographyPreferences(preferences: TypographyPreferences): TypographyPreferences {
  const normalized = normalizeTypographyPreferences(preferences);
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(
      TYPOGRAPHY_STORAGE_KEY,
      JSON.stringify({ version: TYPOGRAPHY_STORAGE_VERSION, preferences: normalized }),
    );
  }
  return normalized;
}

export function applyTypographyProperties(preferences: TypographyPreferences): void {
  if (typeof document === "undefined") return;
  const normalized = normalizeTypographyPreferences(preferences);
  const root = document.documentElement;
  root.style.setProperty("--font-size-ide", `${normalized.ideFontSize}px`);
  root.style.setProperty("--font-size-chat", `${normalized.chatFontSize}px`);
}
