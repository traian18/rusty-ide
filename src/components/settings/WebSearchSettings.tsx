import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useWorkspaceStore } from "../../store";
import styles from "./WebSearchSettings.module.css";

/**
 * Backs agent_chat.ts's core-routed `web_search` host tool (Phase 6,
 * webSearch.ts) -- the one gap in that plan that genuinely needed a new
 * place to store credentials, since none of these 7 search providers are
 * LLM providers with a slot in the existing customProviders list. Keys
 * live in the same encrypted `rusty_secure_config` blob every other
 * provider's apiKey already goes through (createIntegrationSlice.ts).
 */
const PROVIDERS: Array<{ id: string; name: string; hint: string; keyUrl: string }> = [
  { id: "openai", name: "OpenAI", hint: "Uses the Responses API's built-in web_search tool.", keyUrl: "https://platform.openai.com/api-keys" },
  { id: "brave", name: "Brave Search", hint: "", keyUrl: "https://brave.com/search/api/" },
  { id: "tavily", name: "Tavily", hint: "", keyUrl: "https://app.tavily.com/" },
  { id: "exa", name: "Exa", hint: "Works with no key via Exa's public MCP endpoint, always tried first as a free fallback.", keyUrl: "https://exa.ai" },
  { id: "parallel", name: "Parallel", hint: "", keyUrl: "https://platform.parallel.ai" },
  { id: "perplexity", name: "Perplexity", hint: "", keyUrl: "https://perplexity.ai/settings/api" },
  { id: "gemini", name: "Gemini", hint: "", keyUrl: "https://aistudio.google.com/apikey" },
];

function ProviderRow({ provider }: { provider: (typeof PROVIDERS)[number] }) {
  const savedKey = useWorkspaceStore((state) => state.webSearchApiKeys[provider.id] || "");
  const setKey = useWorkspaceStore((state) => state.setWebSearchApiKey);
  const [draft, setDraft] = useState(savedKey);
  const [revealed, setRevealed] = useState(false);
  const dirty = draft !== savedKey;

  return (
    <div className={styles.row}>
      <div className={styles.rowHeader}>
        <label className={styles.label} htmlFor={`web-search-key-${provider.id}`}>{provider.name}</label>
        <a className={styles.link} href={provider.keyUrl} target="_blank" rel="noreferrer">Get a key</a>
      </div>
      {provider.hint && <p className={styles.hint}>{provider.hint}</p>}
      <div className={styles.inputRow}>
        <input
          id={`web-search-key-${provider.id}`}
          className={styles.input}
          type={revealed ? "text" : "password"}
          value={draft}
          placeholder="Not configured"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (dirty) setKey(provider.id, draft);
          }}
        />
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => setRevealed((prev) => !prev)}
          aria-label={revealed ? "Hide key" : "Show key"}
        >
          {revealed ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
      </div>
    </div>
  );
}

export function WebSearchSettings() {
  return (
    <section className={styles.section} aria-labelledby="web-search-title">
      <div className={styles.heading}>
        <div>
          <h3 className={styles.title} id="web-search-title">Web search providers</h3>
          <p className={styles.description}>
            API keys for agent_chat's web_search tool. The first provider below with a configured key is used,
            tried in this order; Exa needs no key at all.
          </p>
        </div>
      </div>
      {PROVIDERS.map((provider) => (
        <ProviderRow key={provider.id} provider={provider} />
      ))}
    </section>
  );
}
