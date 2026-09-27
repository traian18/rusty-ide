// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { SmartReadSettings, SmartSearchSettings, SmartWebExtractSettings } from "./SmartReadSettings";

describe("smart tool settings cards", () => {
  it("renders independent read and search cards whose toggles stay disabled until a selector model is chosen", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(<><SmartReadSettings /><SmartSearchSettings /><SmartWebExtractSettings /></>);
      });
      expect(container.textContent).toContain("Smart file reading");
      expect(container.textContent).toContain("Smart code search");
      expect(container.textContent).toContain("Smart web extraction");
      for (const id of ["smart-read-enabled", "smart-search-enabled", "smart-web-extract-enabled"]) {
        const toggle = container.querySelector<HTMLInputElement>(`#${id}`);
        expect(toggle?.disabled).toBe(true);
      }
      expect(container.textContent).toContain("before enabling smart code search.");
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});
