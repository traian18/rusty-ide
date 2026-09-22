// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DisclaimerModal } from "./DisclaimerModal";
import {
  DISCLAIMER_ACCEPTED_STORAGE_KEY,
  loadHasAcceptedDisclaimer,
} from "../preferences/disclaimer";

let root: Root;
let container: HTMLDivElement;

const store = new Map<string, string>();
const fakeLocalStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value);
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
  clear: () => {
    store.clear();
  },
};

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  store.clear();
  vi.stubGlobal("localStorage", fakeLocalStorage);

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  // Clear any portals appended to document.body
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("DisclaimerModal", () => {
  it("renders when the disclaimer has not been accepted yet", async () => {
    await act(async () => {
      root.render(<DisclaimerModal />);
    });

    const titleEl = document.querySelector("#disclaimer-modal-title");
    expect(titleEl).not.toBeNull();
    expect(titleEl?.textContent).toContain("AI ADVISORY & LIABILITY DISCLAIMER");

    // Check for essential warnings
    expect(document.body.textContent).toContain("IMPORTANT NOTICE ON AI GENERATION");
    expect(document.body.textContent).toContain("Verify all results");
    expect(document.body.textContent).toContain("No liability");

    // Legal detail box should initially be hidden
    expect(document.querySelector("#disclaimer-legal-box")).toBeNull();
  });

  it("does not render when the disclaimer was already accepted", async () => {
    store.set(DISCLAIMER_ACCEPTED_STORAGE_KEY, "true");

    await act(async () => {
      root.render(<DisclaimerModal />);
    });

    expect(document.querySelector("#disclaimer-modal-title")).toBeNull();
    expect(document.querySelector("#disclaimer-modal")).toBeNull();
  });

  it("expands and collapses full legal details when the toggle button is clicked", async () => {
    await act(async () => {
      root.render(<DisclaimerModal />);
    });

    const toggleBtn = document.querySelector("#disclaimer-toggle-details") as HTMLButtonElement;
    expect(toggleBtn).not.toBeNull();
    expect(toggleBtn.textContent).toContain("View Legal Details");

    // Click to view legal details
    await act(async () => {
      toggleBtn.click();
    });

    const legalBox = document.querySelector("#disclaimer-legal-box");
    expect(legalBox).not.toBeNull();
    expect(legalBox?.textContent).toContain("Nature of Generative AI");
    expect(legalBox?.textContent).toContain("Comprehensive Limitation of Liability");
    expect(legalBox?.textContent).toContain("AS IS");
    expect(toggleBtn.textContent).toContain("Hide Legal Details");

    // Click again to collapse
    await act(async () => {
      toggleBtn.click();
    });

    expect(document.querySelector("#disclaimer-legal-box")).toBeNull();
    expect(toggleBtn.textContent).toContain("View Legal Details");
  });

  it("persists acceptance and closes modal when I Understand & Agree is clicked", async () => {
    await act(async () => {
      root.render(<DisclaimerModal />);
    });

    const acceptBtn = document.querySelector("#disclaimer-accept-button") as HTMLButtonElement;
    expect(acceptBtn).not.toBeNull();

    await act(async () => {
      acceptBtn.click();
    });

    // Check that state was saved to localStorage
    expect(store.get(DISCLAIMER_ACCEPTED_STORAGE_KEY)).toBe("true");
    expect(loadHasAcceptedDisclaimer()).toBe(true);

    // Check that modal unmounted
    expect(document.querySelector("#disclaimer-modal")).toBeNull();
  });
});
