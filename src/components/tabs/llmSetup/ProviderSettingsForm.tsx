import type { Dispatch, SetStateAction } from "react";
import { AlertTriangle, Cpu, Globe, Hash, Key, Layers, Lock, Package, PlusCircle, Settings, Tag, Unlock, XCircle } from "lucide-react";
import type { CustomProvider } from "../../../store";
import type { ProviderCapabilities, ProviderHeader } from "../../../store/types";
import { PROFILES } from "../../../integrations/providerConnectionProfiles";
import type { ProviderConfigValidationResult } from "../../../integrations/providerConnectionValidation";
import {
  authPlaceholder,
  withHeaderAdded,
  withHeaderChanged,
  withHeaderRemoved,
  withToolCalling,
} from "./providerDraft";
import {
  CHECKBOX_CLASS,
  FieldLabel,
  FULL_INPUT_CLASS,
  HALF_INPUT_CLASS,
  NOTE_CLASS,
  SelectSetting,
  TextSetting,
} from "./settingFields";

const AUTH_TYPE_OPTIONS = [
  { id: "none", name: "None / Local" },
  { id: "bearer", name: "Bearer token" },
  { id: "anthropic", name: "Anthropic x-api-key" },
];

// "google-generative-ai" is explicitly not supported for direct execution currently
const API_PROTOCOL_OPTIONS = Object.values(PROFILES).map((profile) => ({ id: profile.apiType, name: profile.label }));

type SetDraft = Dispatch<SetStateAction<CustomProvider>>;

const patcher = (setDraft: SetDraft) => (changes: Partial<CustomProvider>) =>
  setDraft((prev) => ({ ...prev, ...changes }));

interface ProviderSettingsFormProps {
  draft: CustomProvider;
  setDraft: SetDraft;
  validation: ProviderConfigValidationResult;
  showKey: boolean;
  onToggleShowKey: () => void;
}

/** Connection settings of a provider Rusty calls over HTTP. */
export function ProviderSettingsForm({ draft, setDraft, validation, showKey, onToggleShowKey }: ProviderSettingsFormProps) {
  const patch = patcher(setDraft);

  return (
    <>
      {/* Basic Settings - Always Visible */}
      <TextSetting id="llm-provider-name" label="Display Name" icon={Tag} placeholder="My Custom LLM" value={draft.name || ""} onChange={(name) => patch({ name })} />
      <TextSetting id="llm-provider-base-url" label="Connection Base URL" icon={Globe} placeholder="e.g. https://api.openai.com/v1" value={draft.baseUrl || ""} onChange={(baseUrl) => patch({ baseUrl })}>
        {validation.warnings.map((warning, idx) => (
          <span key={idx} className="text-[10px] text-[var(--color-status-warning)] leading-relaxed italic block mt-1 font-mono flex items-center space-x-1">
            <AlertTriangle size={10} className="flex-shrink-0" /><span>{warning}</span>
          </span>
        ))}
      </TextSetting>
      <ApiKeySetting draft={draft} showKey={showKey} onToggleShowKey={onToggleShowKey} onChange={(apiKey) => patch({ apiKey })} />

      {/* Advanced Settings */}
      <details className="rounded-xl border border-[var(--border-color)]/60 bg-[var(--bg-app)]/60 p-3 mt-4">
        <summary className="cursor-pointer font-mono text-[10px] font-bold text-[var(--text-normal)] uppercase tracking-wide flex items-center space-x-1.5">
          <Settings size={13} className="text-[var(--color-secondary)]" />
          <span>Advanced Settings</span>
        </summary>
        <AdvancedSettings draft={draft} setDraft={setDraft} />
      </details>
    </>
  );
}

interface ApiKeySettingProps {
  draft: CustomProvider;
  showKey: boolean;
  onToggleShowKey: () => void;
  onChange: (apiKey: string) => void;
}

function ApiKeySetting({ draft, showKey, onToggleShowKey, onChange }: ApiKeySettingProps) {
  const needsNoKey = draft.authType === "none";
  const usesEnvironmentKey = draft.id === "openai" && !draft.apiKey;

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <FieldLabel htmlFor="llm-provider-api-key" icon={Key}>API Authorization Key</FieldLabel>
        {!needsNoKey && (
          <button
            id="llm-toggle-api-key-visibility-button"
            type="button"
            onClick={onToggleShowKey}
            className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors cursor-pointer flex items-center space-x-1 font-mono"
          >
            {showKey ? <><Lock size={10} /><span>Hide</span></> : <><Unlock size={10} /><span>Show</span></>}
          </button>
        )}
      </div>
      <input
        id="llm-provider-api-key"
        type={showKey ? "text" : "password"}
        placeholder={authPlaceholder(draft.authType)}
        value={draft.apiKey || ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={needsNoKey}
        className={`${FULL_INPUT_CLASS} disabled:opacity-50 disabled:cursor-not-allowed`}
      />
      {usesEnvironmentKey && (
        <span className={NOTE_CLASS}>ℹ Environment Variable configuration will be active for this provider since no custom key is provided.</span>
      )}
    </div>
  );
}

function AdvancedSettings({ draft, setDraft }: { draft: CustomProvider; setDraft: SetDraft }) {
  const patch = patcher(setDraft);

  return (
    <div className="space-y-4 pt-4">
      <TextSetting id="llm-provider-id" label="Provider ID" icon={Hash} placeholder="unique-provider-id" value={draft.id || ""} onChange={(id) => patch({ id })} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SelectSetting label="Default API Protocol" value={draft.apiType || ""} options={API_PROTOCOL_OPTIONS} onChange={(apiType) => patch({ apiType })} />
        <SelectSetting label="Authentication" value={draft.authType || ""} options={AUTH_TYPE_OPTIONS} onChange={(authType) => patch({ authType: authType as CustomProvider["authType"] })} />
      </div>
      <TextSetting id="llm-provider-catalog-url" label="Model Catalog URL" icon={Layers} placeholder="Defaults to the base URL plus /models" value={draft.catalogUrl || ""} onChange={(catalogUrl) => patch({ catalogUrl })} />
      <HeadersEditor headers={draft.headers ?? []} setDraft={setDraft} />
      <ToolCallingSetting tools={draft.capabilities?.tools} onToggle={(enabled) => setDraft((prev) => withToolCalling(prev, enabled))} />
    </div>
  );
}

function HeadersEditor({ headers, setDraft }: { headers: ProviderHeader[]; setDraft: SetDraft }) {
  return (
    <div className="space-y-2">
      <FieldLabel icon={Package}>Custom Headers</FieldLabel>
      {headers.map((header, idx) => (
        <HeaderRow
          key={idx}
          header={header}
          onChange={(field, value) => setDraft((prev) => withHeaderChanged(prev, idx, field, value))}
          onRemove={() => setDraft((prev) => withHeaderRemoved(prev, idx))}
        />
      ))}
      <button
        type="button"
        onClick={() => setDraft(withHeaderAdded)}
        className="flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-app)] px-3 py-2 font-mono text-[10px] font-bold text-[var(--text-normal)] hover:border-[var(--accent-color)] hover:text-[var(--text-light)]"
      >
        <PlusCircle size={13} />
        <span>Add Custom Header</span>
      </button>
    </div>
  );
}

interface HeaderRowProps {
  header: ProviderHeader;
  onChange: <K extends keyof ProviderHeader>(field: K, value: ProviderHeader[K]) => void;
  onRemove: () => void;
}

function HeaderRow({ header, onChange, onRemove }: HeaderRowProps) {
  return (
    <div className="flex items-center gap-2">
      <input type="text" placeholder="Header-Name" value={header.name} onChange={(e) => onChange("name", e.target.value)} className={HALF_INPUT_CLASS} />
      <input type={header.secret ? "password" : "text"} placeholder="Header-Value" value={header.value} onChange={(e) => onChange("value", e.target.value)} className={HALF_INPUT_CLASS} />
      <input type="checkbox" checked={header.secret} onChange={(e) => onChange("secret", e.target.checked)} className={CHECKBOX_CLASS} title="Mark as secret" />
      <button type="button" onClick={onRemove} className="text-[var(--color-status-danger)] hover:text-[var(--color-status-danger)]/80 transition-colors" title="Remove header">
        <XCircle size={16} />
      </button>
    </div>
  );
}

function ToolCallingSetting({ tools, onToggle }: { tools: ProviderCapabilities["tools"]; onToggle: (enabled: boolean) => void }) {
  return (
    <div className="space-y-2">
      <FieldLabel icon={Cpu}>Capabilities</FieldLabel>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="llm-capability-tools" checked={tools === "enabled"} onChange={(e) => onToggle(e.target.checked)} className={CHECKBOX_CLASS} />
        <label htmlFor="llm-capability-tools" className="text-sm text-[var(--text-normal)]">
          Enable Tool Calling (requires OpenAI-compatible tools support)
        </label>
      </div>
      {tools === "disabled" && (
        <span className={NOTE_CLASS}>
          Tool calling is disabled by default for custom providers. Enable after confirming model supports OpenAI-compatible tools.
        </span>
      )}
    </div>
  );
}
