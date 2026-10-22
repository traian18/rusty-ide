import { describe, expect, it } from "vitest";
import type { CustomProvider } from "../../../store";
import {
  awaitsDeviceSignIn,
  managedAuthCopy,
  managedHeadline,
  signInButtonLabel,
  verificationPage,
} from "./managedAuth";

const codex = { id: "openai-codex", transport: "openai-codex-app-server" } as CustomProvider;
const copilot = { id: "github-copilot", transport: "github-copilot-sdk" } as CustomProvider;

describe("managedAuth", () => {
  it("picks the vendor's copy", () => {
    expect(managedAuthCopy(codex)).toMatchObject({ vendor: "OpenAI", product: "Codex" });
    expect(managedAuthCopy(copilot)).toMatchObject({ vendor: "GitHub", product: "Copilot" });
  });

  it("describes each sign-in state", () => {
    expect(managedHeadline({ kind: "loading" }, "GitHub")).toBe("Connecting to GitHub");
    expect(managedHeadline({ kind: "ready", account: "octocat" }, "GitHub")).toBe("Connected as octocat");
    expect(managedHeadline({ kind: "ready" }, "GitHub")).toBe("Connected");
    expect(managedHeadline({ kind: "error" }, "GitHub")).toBe("GitHub sign-in required");
    expect(signInButtonLabel({ kind: "unknown" }, "OpenAI")).toBe("Sign in with OpenAI");
  });

  it("shows the device card only while a sign-in has something to show", () => {
    expect(awaitsDeviceSignIn({ kind: "loading" })).toBe(false);
    expect(awaitsDeviceSignIn({ kind: "loading", verificationUri: "https://x" })).toBe(true);
    expect(awaitsDeviceSignIn({ kind: "ready", userCode: "ABCD" })).toBe(false);
  });

  it("falls back to the vendor's device page", () => {
    expect(verificationPage({ kind: "loading" }, managedAuthCopy(codex))).toBe("https://auth.openai.com/codex/device");
    expect(verificationPage({ kind: "loading", verificationUri: "https://own" }, managedAuthCopy(copilot))).toBe("https://own");
  });
});
