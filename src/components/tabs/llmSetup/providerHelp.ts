const PROVIDER_HELP_TEXT: Record<string, string[]> = {
  openai: [
    "Connects directly to OpenAI's completion servers.",
    "If API Key is left blank, it falls back to OPENAI_API_KEY in the sidecar environment.",
  ],
  "openai-codex": [
    "Uses your existing OpenAI Codex sign-in through the bundled official Codex app-server.",
    "Credentials are shared with Codex CLI/Desktop via ~/.codex.",
    "Available models come from your account, while Rusty controls workspace tools and permissions.",
  ],
  anthropic: [
    "Connects directly to Anthropic's Claude API.",
    "If API Key is left blank, it falls back to ANTHROPIC_API_KEY in the sidecar environment.",
  ],
  "anthropic-claude-code": [
    "Uses Anthropic's official Claude Agent SDK and local Claude Code authentication.",
    "Sign in with Claude Code using /login, or provide ANTHROPIC_API_KEY in the sidecar environment.",
    "Rusty supplies and controls the workspace tools.",
  ],
  opencode: [
    "Connects to OpenCode Zen and uses OPENCODE_API_KEY when the key is blank.",
    "Model discovery enriches the Zen catalog with each model's required protocol.",
    "Register OpenCode Go separately as opencode-go with its dedicated base URL.",
  ],
  openrouter: [
    "Connects to OpenRouter's unified OpenAI-compatible API gateway.",
    "If API Key is left blank, it falls back to OPENROUTER_API_KEY in the environment.",
    "Use Fetch Models to discover available models across providers.",
  ],
  "github-models": [
    "Connects to GitHub Models through the official OpenAI-compatible inference API.",
    "It needs a PAT with the models:read scope, or GITHUB_TOKEN in the sidecar environment.",
    "Use Fetch Models to load the official catalog.",
  ],
  "github-copilot": [
    "Uses your GitHub Copilot subscription through GitHub's official Copilot SDK.",
    "The bundled CLI and system credential store manage authentication.",
    "Available models and premium-request usage depend on your plan and organization policy.",
  ],
};

const DEFAULT_PROVIDER_HELP_TEXT = [
  "Custom OpenAI-compatible provider, such as Ollama, LM Studio, vLLM, or LiteLLM gateway.",
  "Configure the URL and models as needed.",
].join(" ");

export function providerHelpText(providerId: string): string {
  return PROVIDER_HELP_TEXT[providerId]?.join(" ") || DEFAULT_PROVIDER_HELP_TEXT;
}
