// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const openUrl = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));
const controlPlane = vi.hoisted(() => ({ discoverModels: vi.fn(), testConnection: vi.fn() }));
vi.mock("../../harness/HybridControlPlane", () => ({ hybridControlPlane: controlPlane }));
const coordinator = vi.hoisted(() => ({
  startManagedLogin: vi.fn(),
  logoutManaged: vi.fn(),
  cancelManagedLogin: vi.fn(),
}));
vi.mock("../shell/providerCoordinator", () => coordinator);

import { useWorkspaceStore, type CustomProvider, type ProviderStatus } from "../../store";
import { useNotificationStore } from "../../notificationStore";
import { LlmSetupTab } from "./LlmSetupTab";

const ollama: CustomProvider = {
  id: "ollama",
  name: "Ollama",
  baseUrl: "http://localhost:11434/v1",
  apiKey: "",
  apiType: "openai-completions",
  authType: "none",
  models: [
    { id: "ollama/legacy", name: "legacy", supported: false },
    { id: "ollama/llama3", name: "llama3", remoteId: "llama3", contextWindow: 8192 },
  ],
};

const copilot: CustomProvider = {
  id: "github-copilot",
  name: "GitHub Copilot",
  baseUrl: "",
  apiKey: "",
  apiType: "openai-completions",
  transport: "github-copilot-sdk",
  models: [],
};

const codex: CustomProvider = { ...copilot, id: "openai-codex", name: "Codex", transport: "openai-codex-app-server" };

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

async function renderTab(state: {
  providers?: CustomProvider[];
  activeId?: string | null;
  activeModel?: string;
  status?: Record<string, ProviderStatus>;
} = {}) {
  useWorkspaceStore.setState({
    customProviders: state.providers ?? [ollama],
    activeCustomProviderId: state.activeId === undefined ? "ollama" : state.activeId,
    activeModel: state.activeModel ?? "ollama/llama3",
    providerStatus: state.status ?? {},
  });
  await act(async () => root.render(<LlmSetupTab />));
}

const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector);
const text = () => container.textContent ?? "";
const store = () => useWorkspaceStore.getState();
const lastNotice = () => useNotificationStore.getState().notification;
const provider = (id: string) => store().customProviders.find((candidate) => candidate.id === id);

async function click(target: string | HTMLElement) {
  const element = typeof target === "string" ? $(target) : target;
  if (!element) throw new Error(`missing ${target}`);
  await act(async () => element.click());
}

async function type(selector: string, value: string) {
  const input = $<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submitConnectForm() {
  await act(async () => {
    $("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

async function chooseOption(selectId: string, label: string) {
  await click(`#${selectId}`);
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((candidate) => candidate.textContent === label);
  if (!option) throw new Error(`missing option ${label}`);
  await click(option);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  invoke.mockResolvedValue(undefined);
  useNotificationStore.setState({ notification: null });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("LlmSetupTab provider selection", () => {
  it("asks for a provider when none is selected", async () => {
    await renderTab({ activeId: null });
    expect(text()).toContain("No Active Provider Selected");
  });

  it("picks the first supported model when no model is active", async () => {
    await renderTab({ activeModel: "" });
    expect(store().activeModel).toBe("ollama/llama3");
    expect(text()).toContain("1 catalog entries are hidden");
  });

  it("activates a provider and its first supported model from the list", async () => {
    const vllm: CustomProvider = { ...ollama, id: "vllm", name: "vLLM", models: [{ id: "vllm/qwen", name: "qwen" }] };
    await renderTab({ providers: [ollama, vllm] });
    const entry = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("vLLM"));
    await click(entry!);
    expect(store().activeCustomProviderId).toBe("vllm");
    expect(store().activeModel).toBe("vllm/qwen");
    expect(text()).toContain("vLLM Settings");
  });
});

describe("LlmSetupTab connect service form", () => {
  beforeEach(async () => {
    await renderTab();
    await click("#llm-register-custom-provider-button");
  });

  it("requires a display name", async () => {
    await submitConnectForm();
    expect(lastNotice()).toMatchObject({ title: "Display name required", variant: "error" });
    expect(store().customProviders).toHaveLength(1);
  });

  it("requires a base URL", async () => {
    await type("#llm-custom-provider-name", "Lab");
    await submitConnectForm();
    expect(lastNotice()).toMatchObject({ title: "Base URL required", variant: "error" });
  });

  it("rejects an invalid configuration", async () => {
    await type("#llm-custom-provider-name", "Lab");
    await type("#llm-custom-provider-url", "not a url");
    await submitConnectForm();
    expect(lastNotice()).toMatchObject({ title: "Configuration invalid", variant: "error" });
    expect(store().customProviders).toHaveLength(1);
  });

  it("saves a new provider with a unique id and activates its model", async () => {
    await type("#llm-custom-provider-name", " Ollama ");
    await type("#llm-custom-provider-url", "http://localhost:11500/v1 ");
    await type("#llm-model-id", " library/qwen3 ");
    await submitConnectForm();

    const saved = provider("ollama-1")!;
    expect(saved).toMatchObject({
      name: "Ollama",
      baseUrl: "http://localhost:11500/v1",
      apiType: "openai-completions",
      authType: "none",
      profile: "openai-compatible",
      capabilities: { tools: "enabled" },
      models: [{
        id: "ollama-1/library/qwen3",
        remoteId: "library/qwen3",
        name: "qwen3",
        apiType: "openai-completions",
        baseUrl: "http://localhost:11500/v1",
        supported: true,
      }],
    });
    expect(store().activeCustomProviderId).toBe("ollama-1");
    expect(store().activeModel).toBe("ollama-1/library/qwen3");
    expect(lastNotice()).toMatchObject({ title: "Saved", variant: "success" });
    expect($("#llm-custom-provider-name")).toBeNull();
  });

  it("keeps an unsaved draft when the form is cancelled and reopened", async () => {
    await type("#llm-custom-provider-name", "Draft");
    await click("#llm-cancel-custom-provider-button");
    await click("#llm-register-custom-provider-button");
    expect($<HTMLInputElement>("#llm-custom-provider-name")!.value).toBe("Draft");
  });

  it("fills the preset's defaults when a service type is chosen", async () => {
    await chooseOption("llm-service-preset", "OpenRouter");
    expect($<HTMLInputElement>("#llm-custom-provider-name")!.value).toBe("OpenRouter");
    expect($<HTMLInputElement>("#llm-custom-provider-url")!.value).toBe("https://openrouter.ai/api/v1");
  });
});

describe("LlmSetupTab provider settings", () => {
  it("saves edited settings and blocks saving an invalid URL", async () => {
    await renderTab();
    await type("#llm-provider-base-url", "ftp://nowhere");
    expect($<HTMLButtonElement>("#llm-save-configuration-button")!.disabled).toBe(true);

    await type("#llm-provider-base-url", "http://localhost:11434/v2");
    await type("#llm-provider-name", "Local Ollama");
    await click("#llm-save-configuration-button");
    expect(provider("ollama")).toMatchObject({ name: "Local Ollama", baseUrl: "http://localhost:11434/v2" });
    expect(lastNotice()).toMatchObject({ title: "Saved", message: "Connection settings updated for Local Ollama." });
  });

  it("adds, edits and removes custom headers", async () => {
    await renderTab();
    const addHeader = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Add Custom Header")!;
    await click(addHeader);
    await click(addHeader);
    await type('input[placeholder="Header-Name"]', "X-Team");
    await type('input[placeholder="Header-Value"]', "rusty");
    await click(container.querySelectorAll<HTMLButtonElement>('button[title="Remove header"]')[1]);
    await click("#llm-save-configuration-button");
    expect(provider("ollama")!.headers).toEqual([{ name: "X-Team", value: "rusty", secret: false }]);
  });

  it("hides and shows the API key and disables it without auth", async () => {
    const keyed: CustomProvider = { ...ollama, authType: "bearer", apiKey: "sk-test" };
    await renderTab({ providers: [keyed] });
    expect($<HTMLInputElement>("#llm-provider-api-key")!.type).toBe("password");
    await click("#llm-toggle-api-key-visibility-button");
    expect($<HTMLInputElement>("#llm-provider-api-key")!.type).toBe("text");

    await act(async () => root.unmount());
    root = createRoot(container);
    await renderTab();
    expect($<HTMLInputElement>("#llm-provider-api-key")!.disabled).toBe(true);
    expect($("#llm-toggle-api-key-visibility-button")).toBeNull();
  });

  it("toggles tool calling", async () => {
    await renderTab({ providers: [{ ...ollama, capabilities: { tools: "disabled" } }] });
    expect(text()).toContain("Tool calling is disabled by default");
    await click("#llm-capability-tools");
    await click("#llm-save-configuration-button");
    expect(provider("ollama")!.capabilities).toEqual({ tools: "enabled" });
  });
});

describe("LlmSetupTab catalogue and connection checks", () => {
  it("merges discovered models into the catalogue and switches to a listed model", async () => {
    controlPlane.discoverModels.mockResolvedValue([
      { id: "ollama/qwen", name: "qwen", remoteId: "llama3" },
      { id: "ollama/old", name: "old", supported: false },
    ]);
    await renderTab({ activeModel: "ollama/gone" });
    await click("#llm-update-model-catalogue-button");

    const saved = provider("ollama")!;
    expect(saved.models[0]).toMatchObject({ id: "ollama/qwen", name: "qwen", contextWindow: 8192 });
    expect(saved.modelsFetchedAt).toEqual(expect.any(String));
    expect(saved.executionStatus?.catalog?.status).toBe("success");
    expect(store().activeModel).toBe("ollama/qwen");
    expect(lastNotice()).toMatchObject({
      title: "Models refreshed",
      message: "Loaded 1 supported model; 1 unsupported catalog entries were disabled.",
      variant: "success",
    });
  });

  it("records a failed catalogue refresh", async () => {
    controlPlane.discoverModels.mockRejectedValue(new Error("offline"));
    await renderTab();
    await click("#llm-update-model-catalogue-button");
    expect(provider("ollama")!.executionStatus?.catalog).toMatchObject({ status: "failed", message: "offline" });
    expect(lastNotice()).toMatchObject({ title: "Fetch failed", message: "Failed to fetch models: offline", variant: "error" });
    expect($<HTMLButtonElement>("#llm-update-model-catalogue-button")!.disabled).toBe(false);
  });

  it("records connection test results", async () => {
    controlPlane.testConnection.mockResolvedValue({ modelCount: 3, supportedModelCount: 2 });
    await renderTab();
    await click("#llm-test-connection-button");
    expect(provider("ollama")!.executionStatus?.inference?.status).toBe("success");
    expect(lastNotice()).toMatchObject({ title: "Connection successful", message: "Ollama returned 3 models; 2 are supported by Rusty." });

    controlPlane.testConnection.mockRejectedValue(new Error("refused"));
    await click("#llm-test-connection-button");
    expect(provider("ollama")!.executionStatus?.inference).toMatchObject({ status: "failed", message: "refused" });
    expect(lastNotice()).toMatchObject({ title: "Connection failed", message: "refused", variant: "error" });
  });
});

describe("LlmSetupTab managed sign-in", () => {
  it("shows the device code flow while signing in", async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal("navigator", { ...navigator, clipboard });
    await renderTab({
      providers: [copilot],
      activeId: "github-copilot",
      activeModel: "",
      status: { "github-copilot": { kind: "loading", userCode: "ABCD-1234", verificationUri: "https://github.com/login/device?x=1" } },
    });

    expect(text()).toContain("Connecting to GitHub");
    expect(text()).toContain("GitHub device code");
    expect($<HTMLButtonElement>("#llm-update-model-catalogue-button")!.disabled).toBe(true);
    expect($<HTMLButtonElement>("#llm-test-connection-button")!.disabled).toBe(true);
    expect($("#llm-save-configuration-button")).toBeNull();
    expect($<HTMLButtonElement>("#llm-managed-sign-in-button")!.textContent).toBe("Signing in…");

    await click("#llm-copy-managed-code-button");
    expect(clipboard.writeText).toHaveBeenCalledWith("ABCD-1234");
    await click("#llm-open-managed-verification-button");
    expect(openUrl).toHaveBeenCalledWith("https://github.com/login/device?x=1");

    coordinator.cancelManagedLogin.mockResolvedValue(undefined);
    await click("#llm-cancel-managed-login-button");
    expect(coordinator.cancelManagedLogin).toHaveBeenCalledWith(copilot);
    expect(lastNotice()).toMatchObject({ title: "Sign-in cancelled", message: "Cancelled GitHub sign-in attempt." });
  });

  it("falls back to the vendor's device page and reports sign-in failures", async () => {
    await renderTab({
      providers: [codex],
      activeId: "openai-codex",
      activeModel: "",
      status: { "openai-codex": { kind: "unauthenticated", diagnostics: ["line 1", "line 2"] } },
    });
    expect(text()).toContain("OpenAI sign-in required");
    expect(text()).toContain("Use the OpenAI account connected to your Codex plan.");
    expect($<HTMLButtonElement>("#llm-managed-sign-in-button")!.textContent).toBe("Sign in with OpenAI");
    expect(text()).toContain("Sign in with OpenAI to load Codex models");
    expect($("#llm-open-managed-verification-button")).toBeNull();

    coordinator.startManagedLogin.mockRejectedValue(new Error("sidecar missing"));
    await click("#llm-managed-sign-in-button");
    expect(lastNotice()).toMatchObject({ title: "Sign-in failed", message: "sidecar missing", variant: "error" });

    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal("navigator", { ...navigator, clipboard });
    await click("#llm-copy-managed-diagnostics-button");
    expect(clipboard.writeText).toHaveBeenCalledWith("line 1\nline 2");
  });

  it("opens the fallback device page when the status has only a code", async () => {
    await renderTab({
      providers: [codex],
      activeId: "openai-codex",
      activeModel: "",
      status: { "openai-codex": { kind: "loading", userCode: "WXYZ" } },
    });
    await click("#llm-open-managed-verification-button");
    expect(openUrl).toHaveBeenCalledWith("https://auth.openai.com/codex/device");
    expect(text()).toContain("https://auth.openai.com/codex/device");
  });

  it("signs out of a connected account", async () => {
    coordinator.logoutManaged.mockResolvedValue(undefined);
    await renderTab({
      providers: [{ ...copilot, models: [{ id: "github-copilot/gpt-5", name: "gpt-5" }] }],
      activeId: "github-copilot",
      status: { "github-copilot": { kind: "ready", account: "octocat", host: "https://github.com" } },
    });
    expect(text()).toContain("Connected as octocat");
    expect(text()).toContain("https://github.com");
    expect($<HTMLButtonElement>("#llm-test-connection-button")!.disabled).toBe(false);
    expect($<HTMLButtonElement>("#llm-managed-sign-in-button")!.textContent).toBe("Re-authenticate");

    await click("#llm-managed-sign-out-button");
    expect(coordinator.logoutManaged).toHaveBeenCalled();
    expect(lastNotice()).toMatchObject({ title: "Signed out", message: "Disconnected the GitHub account from Copilot." });
  });
});
