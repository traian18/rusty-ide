import type { CustomProvider, LspSettings } from "../../../store/types";

/** Matches src/theme.ts's own default (`themes.dark`); a bare string
 * literal here rather than an import + resolveTheme() call, matching this
 * file's existing `activeCustomProviderId: "opencode"` precedent -- the
 * point is a constant with no I/O, not resolving it through the registry. */
export const DEFAULT_THEME_ID = "dark";

export const defaultProviders: CustomProvider[] = [
  {
    id: "opencode",
    name: "OpenCode Zen",
    baseUrl: "https://opencode.ai/zen/v1",
    apiKey: "",
    apiType: "openai-completions",
    authType: "bearer",
    catalogUrl: "https://opencode.ai/zen/v1/models",
    models: [],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "",
    apiType: "openai-completions",
    authType: "bearer",
    catalogUrl: "https://openrouter.ai/api/v1/models",
    models: [],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: "",
    apiType: "anthropic-messages",
    authType: "anthropic",
    catalogUrl: "https://api.anthropic.com/v1/models",
    models: [
      { id: "anthropic/claude-sonnet-4-6", remoteId: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", apiType: "anthropic-messages", baseUrl: "https://api.anthropic.com", supported: true, reasoning: true, supportedReasoningEfforts: ["minimal", "low", "medium", "high"] },
      { id: "anthropic/claude-opus-4-6", remoteId: "claude-opus-4-6", name: "Claude Opus 4.6", apiType: "anthropic-messages", baseUrl: "https://api.anthropic.com", supported: true, reasoning: true, supportedReasoningEfforts: ["minimal", "low", "medium", "high"] },
      { id: "anthropic/claude-haiku-4-5", remoteId: "claude-haiku-4-5", name: "Claude Haiku 4.5", apiType: "anthropic-messages", baseUrl: "https://api.anthropic.com", supported: true, reasoning: true, supportedReasoningEfforts: ["minimal", "low", "medium", "high"] },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    apiType: "openai-responses",
    authType: "bearer",
    catalogUrl: "https://api.openai.com/v1/models",
    models: [
      { id: "openai/gpt-5.6-sol", remoteId: "gpt-5.6-sol", name: "GPT-5.6 Sol", apiType: "openai-responses", baseUrl: "https://api.openai.com/v1", supported: true, reasoning: true, supportedReasoningEfforts: ["minimal", "low", "medium", "high", "xhigh"], defaultReasoningEffort: "medium", input: ["text", "image"], contextWindow: 1_050_000, maxTokens: 128_000, cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 6.25 } },
      { id: "openai/gpt-5.6-terra", remoteId: "gpt-5.6-terra", name: "GPT-5.6 Terra", apiType: "openai-responses", baseUrl: "https://api.openai.com/v1", supported: true, reasoning: true, supportedReasoningEfforts: ["minimal", "low", "medium", "high", "xhigh"], defaultReasoningEffort: "medium", input: ["text", "image"], contextWindow: 1_050_000, maxTokens: 128_000, cost: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 3.125 } },
      { id: "openai/gpt-5.6-luna", remoteId: "gpt-5.6-luna", name: "GPT-5.6 Luna", apiType: "openai-responses", baseUrl: "https://api.openai.com/v1", supported: true, reasoning: true, supportedReasoningEfforts: ["minimal", "low", "medium", "high", "xhigh"], defaultReasoningEffort: "medium", input: ["text", "image"], contextWindow: 1_050_000, maxTokens: 128_000, cost: { input: 1, output: 6, cacheRead: 0.1, cacheWrite: 1.25 } },
    ],
  },
  {
    id: "openai-codex",
    name: "OpenAI Codex",
    baseUrl: "",
    apiKey: "",
    apiType: "codex-app-server",
    transport: "openai-codex-app-server",
    authType: "environment",
    models: [
      { id: "openai-codex/gpt-6.1-sol", remoteId: "gpt-6.1-sol", name: "GPT-6.1 Sol", apiType: "codex-app-server", supported: true, reasoning: true, supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"], defaultReasoningEffort: "medium" },
      { id: "openai-codex/gpt-6-astra", remoteId: "gpt-6-astra", name: "GPT-6 Astra", apiType: "codex-app-server", supported: true, reasoning: true, supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"], defaultReasoningEffort: "medium" },
      { id: "openai-codex/gpt-6-sol", remoteId: "gpt-6-sol", name: "GPT-6 Sol", apiType: "codex-app-server", supported: true, reasoning: true, supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"], defaultReasoningEffort: "medium" },
      { id: "openai-codex/gpt-6-luna", remoteId: "gpt-6-luna", name: "GPT-6 Luna", apiType: "codex-app-server", supported: true, reasoning: true, supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"], defaultReasoningEffort: "medium" },
      { id: "openai-codex/gpt-5.6-sol", remoteId: "gpt-5.6-sol", name: "GPT-5.6 Sol", apiType: "codex-app-server", supported: true, reasoning: true, supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"], defaultReasoningEffort: "medium" },
      { id: "openai-codex/gpt-5.6-terra", remoteId: "gpt-5.6-terra", name: "GPT-5.6 Terra", apiType: "codex-app-server", supported: true, reasoning: true, supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"], defaultReasoningEffort: "medium" },
      { id: "openai-codex/gpt-5.6-luna", remoteId: "gpt-5.6-luna", name: "GPT-5.6 Luna", apiType: "codex-app-server", supported: true, reasoning: true, supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"], defaultReasoningEffort: "medium" },
    ],
  },
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    baseUrl: "",
    apiKey: "",
    apiType: "copilot-sdk",
    transport: "github-copilot-sdk",
    authType: "environment",
    models: [],
  },
  {
    id: "github-models",
    name: "GitHub Models",
    baseUrl: "https://models.github.ai/inference",
    apiKey: "",
    apiType: "openai-completions",
    authType: "bearer",
    catalogUrl: "https://models.github.ai/catalog/models",
    models: [],
  },
];

export const defaultLspSettings: LspSettings = {
  enabled: false,
  servers: {
    typescript: { serverPath: "typescript-language-server", args: ["--stdio"] },
    python: { serverPath: "pyright-langserver", args: ["--stdio"] },
    go: { serverPath: "gopls", args: [] },
    rust: { serverPath: "rust-analyzer", args: [] },
    java: { serverPath: "jdtls", args: [] },
    c: { serverPath: "clangd", args: [] },
    cpp: { serverPath: "clangd", args: [] },
    csharp: { serverPath: "csharp-ls", args: [] },
    ruby: { serverPath: "ruby-lsp", args: [] },
    php: { serverPath: "intelephense", args: ["--stdio"] },
    lua: { serverPath: "lua-language-server", args: [] },
    bash: { serverPath: "bash-language-server", args: ["start"] },
    json: { serverPath: "vscode-json-language-server", args: ["--stdio"] },
    yaml: { serverPath: "yaml-language-server", args: ["--stdio"] },
    html: { serverPath: "vscode-html-language-server", args: ["--stdio"] },
    css: { serverPath: "vscode-css-language-server", args: ["--stdio"] },
  },
};
