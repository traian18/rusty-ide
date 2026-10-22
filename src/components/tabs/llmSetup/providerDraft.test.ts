import { describe, expect, it } from "vitest";
import type { CustomProvider } from "../../../store";
import {
  authPlaceholder,
  modelOptions,
  validateDraft,
  withHeaderAdded,
  withHeaderChanged,
  withHeaderRemoved,
  withToolCalling,
} from "./providerDraft";

const provider = (changes: Partial<CustomProvider> = {}): CustomProvider => ({
  id: "lab",
  name: "Lab",
  baseUrl: "http://localhost:8000/v1",
  apiKey: "",
  apiType: "openai-completions",
  authType: "none",
  models: [],
  ...changes,
});

describe("providerDraft", () => {
  it("validates the draft's URL", () => {
    expect(validateDraft(provider()).valid).toBe(true);
    expect(validateDraft(provider({ baseUrl: "" })).valid).toBe(false);
  });

  it("edits headers", () => {
    const added = withHeaderAdded(withHeaderAdded(provider()));
    const named = withHeaderChanged(added, 1, "name", "X-Team");
    expect(withHeaderRemoved(named, 0).headers).toEqual([{ name: "X-Team", value: "", secret: false }]);
  });

  it("leaves a draft without headers alone", () => {
    const draft = provider();
    expect(withHeaderChanged(draft, 0, "name", "X")).toBe(draft);
    expect(withHeaderRemoved(draft, 0)).toBe(draft);
  });

  it("toggles tool calling", () => {
    expect(withToolCalling(provider({ capabilities: { tools: "enabled" } }), false).capabilities).toEqual({ tools: "disabled" });
  });

  it("names the key each auth type expects", () => {
    expect(authPlaceholder("bearer")).toBe("Enter your Bearer Token");
    expect(authPlaceholder("environment")).toBe("Enter your API Key / Auth Token");
    expect(authPlaceholder(undefined)).toBe("Enter your API Key / Auth Token");
  });

  it("lists supported models with their remote ids", () => {
    const options = modelOptions(provider({
      models: [
        { id: "lab/a", name: "a", remoteId: "org/a" },
        { id: "lab/b", name: "b", supported: false },
        { id: "lab/c", name: "c" },
      ],
    }));
    expect(options).toEqual([{ id: "lab/a", name: "a (org/a)" }, { id: "lab/c", name: "c (lab/c)" }]);
  });
});
