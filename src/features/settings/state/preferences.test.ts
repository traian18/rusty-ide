import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPreferencesTestStore } from "../../../test/preferencesTestStore";
import { TYPOGRAPHY_DEFAULTS, TYPOGRAPHY_STORAGE_KEY, TYPOGRAPHY_STORAGE_VERSION } from "../service/typography";
import { SHORTCUT_DEFAULTS, SHORTCUT_STORAGE_KEY } from "../service/shortcuts";
import { SECRET_SHIELD_DEFAULT_POLICY, loadSecretShieldPolicy, saveSecretShieldPolicy } from "../service/secretShield";

describe("createPreferencesSlice: creation-time purity (REFACTOR_PLAN.md PR 3a)", () => {
  it("composes without throwing even when localStorage.getItem throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("access denied");
      },
    });
    try {
      expect(() => createPreferencesTestStore()).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("initializes typographyPreferences/keyboardShortcuts to constants, ignoring localStorage entirely", () => {
    const store = new Map<string, string>();
    store.set(
      TYPOGRAPHY_STORAGE_KEY,
      JSON.stringify({ version: TYPOGRAPHY_STORAGE_VERSION, preferences: { editorFontSize: 20, chatFontSize: 20, ideFontSize: 20 } }),
    );
    store.set(SHORTCUT_STORAGE_KEY, JSON.stringify({ ...SHORTCUT_DEFAULTS, openSearch: "Mod+P" }));
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });

    try {
      const state = createPreferencesTestStore().getState();
      // Constants, not the (deliberately unread) stored values above.
      expect(state.typographyPreferences).toEqual(TYPOGRAPHY_DEFAULTS);
      expect(state.keyboardShortcuts).toEqual(SHORTCUT_DEFAULTS);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("createPreferencesSlice: hydrateTypography / hydrateShortcuts", () => {
  const store = new Map<string, string>();
  const fakeLocalStorage: Pick<Storage, "getItem" | "setItem"> = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
  };

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", fakeLocalStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hydrateTypography reads a stored preference after creation", () => {
    store.set(
      TYPOGRAPHY_STORAGE_KEY,
      JSON.stringify({ version: TYPOGRAPHY_STORAGE_VERSION, preferences: { editorFontSize: 18, chatFontSize: 15, ideFontSize: 13 } }),
    );
    const testStore = createPreferencesTestStore();

    expect(testStore.getState().typographyPreferences).toEqual(TYPOGRAPHY_DEFAULTS);
    testStore.getState().hydrateTypography();
    expect(testStore.getState().typographyPreferences).toEqual({
      editorFontSize: 18,
      chatFontSize: 15,
      ideFontSize: 13,
    });
  });

  it("hydrateTypography falls back to defaults when nothing is stored", () => {
    const testStore = createPreferencesTestStore();
    testStore.getState().hydrateTypography();
    expect(testStore.getState().typographyPreferences).toEqual(TYPOGRAPHY_DEFAULTS);
  });

  it("hydrateShortcuts reads stored shortcuts after creation", () => {
    store.set(SHORTCUT_STORAGE_KEY, JSON.stringify({ ...SHORTCUT_DEFAULTS, openSearch: "Mod+P" }));
    const testStore = createPreferencesTestStore();

    expect(testStore.getState().keyboardShortcuts).toEqual(SHORTCUT_DEFAULTS);
    testStore.getState().hydrateShortcuts();
    expect(testStore.getState().keyboardShortcuts.openSearch).toBe("Mod+P");
  });

  it("hydrateShortcuts falls back to defaults when nothing is stored", () => {
    const testStore = createPreferencesTestStore();
    testStore.getState().hydrateShortcuts();
    expect(testStore.getState().keyboardShortcuts).toEqual(SHORTCUT_DEFAULTS);
  });

  it("hydrates and persists the Secret Shield policy, defaulting to mask", () => {
    const testStore = createPreferencesTestStore();
    expect(testStore.getState().secretShieldPolicy).toBe(SECRET_SHIELD_DEFAULT_POLICY);
    testStore.getState().hydrateSecretShieldPolicy();
    expect(testStore.getState().secretShieldPolicy).toBe("mask");

    testStore.getState().setSecretShieldPolicy("block");
    expect(loadSecretShieldPolicy()).toBe("block");
  });

  it("resets the persisted policy when saving fails", () => {
    vi.stubGlobal("localStorage", { setItem: () => { throw new Error("denied"); } });
    const policy = saveSecretShieldPolicy("warn");
    expect(policy).toBe("warn");
    vi.unstubAllGlobals();
  });

  it("hydrates the saved Secret Shield policy", () => {
    store.set("rusty.secretShieldPolicy", "warn");
    const testStore = createPreferencesTestStore();
    testStore.getState().hydrateSecretShieldPolicy();
    expect(testStore.getState().secretShieldPolicy).toBe("warn");
  });
});
