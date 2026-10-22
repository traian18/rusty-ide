import { useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { Plus } from "lucide-react";
import { useWorkspaceStore } from "../../../store";
import { notify } from "../../../notificationStore";
import type { PresetId } from "../../../integrations/providerConnectionProfiles";
import { CustomSelect } from "../../CustomSelect";
import {
  buildNewProvider,
  checkNewProvider,
  EMPTY_NEW_PROVIDER_DRAFT,
  SERVICE_PRESET_OPTIONS,
  withPreset,
  type NewProviderDraft,
} from "./newProvider";

const LABEL_CLASS = "block text-[9px] uppercase font-bold text-[var(--text-muted)] font-mono";
const inputClass = (mono: boolean) =>
  `w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg p-2 text-xs ${mono ? "font-mono " : ""}text-[var(--text-light)] focus:outline-none focus:border-[var(--border-active)]`;

/** Adds the draft as a new provider and activates it; false when the draft cannot be saved. */
function useSaveNewProvider() {
  const customProviders = useWorkspaceStore((state) => state.customProviders);
  const addCustomProvider = useWorkspaceStore((state) => state.addCustomProvider);
  const setActiveCustomProviderId = useWorkspaceStore((state) => state.setActiveCustomProviderId);
  const setActiveModel = useWorkspaceStore((state) => state.setActiveModel);

  return (draft: NewProviderDraft): boolean => {
    const check = checkNewProvider(draft);
    if (!check.ok) {
      notify(check.title, check.message, "error");
      return false;
    }
    check.warnings.forEach((warning) => notify("Warning", warning));

    const provider = buildNewProvider(draft, customProviders);
    addCustomProvider(provider);
    setActiveCustomProviderId(provider.id);
    if (provider.models.length > 0) setActiveModel(provider.models[0].id);
    notify("Saved", `Provider ${draft.name} saved successfully!`, "success");
    return true;
  };
}

/** The Connect an Inference Service button and the form it opens. The draft
    outlives Cancel, so reopening the form shows what was typed. */
export function ConnectServicePanel() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<NewProviderDraft>(EMPTY_NEW_PROVIDER_DRAFT);
  const saveNewProvider = useSaveNewProvider();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!saveNewProvider(draft)) return;
    setDraft(EMPTY_NEW_PROVIDER_DRAFT);
    setOpen(false);
    if (draft.discoverAfterSave) {
      // This will be implemented in later task for discovery
      console.log("Discovery after save would be triggered here");
    }
  };

  if (!open) {
    return (
      <button
        id="llm-register-custom-provider-button"
        type="button"
        onClick={() => setOpen(true)}
        className="w-full border border-dashed border-[var(--border-color)] hover:border-[var(--accent-color)] hover:bg-[var(--accent-bg)]/5 text-xs text-[var(--text-muted)] hover:text-[var(--text-light)] font-mono font-semibold py-3 rounded-xl transition-all flex items-center justify-center space-x-1.5 cursor-pointer"
      >
        <Plus size={14} className="text-[var(--accent-color)]" />
        <span>Connect an Inference Service</span>
      </button>
    );
  }
  return <ConnectServiceForm draft={draft} setDraft={setDraft} onCancel={() => setOpen(false)} onSubmit={handleSubmit} />;
}

interface DraftFieldProps {
  id: string;
  label: string;
  type: "text" | "password";
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  mono?: boolean;
  required?: boolean;
}

function DraftField({ id, label, type, placeholder, value, onChange, mono = true, required }: DraftFieldProps) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className={LABEL_CLASS}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass(mono)}
        required={required}
      />
    </div>
  );
}

interface ConnectServiceFormProps {
  draft: NewProviderDraft;
  setDraft: Dispatch<SetStateAction<NewProviderDraft>>;
  onCancel: () => void;
  onSubmit: (event: FormEvent) => void;
}

function ConnectServiceForm({ draft, setDraft, onCancel, onSubmit }: ConnectServiceFormProps) {
  const update = (changes: Partial<NewProviderDraft>) => setDraft((prev) => ({ ...prev, ...changes }));

  return (
    <form
      onSubmit={onSubmit}
      className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl p-4 space-y-3 font-sans"
    >
      <div className="flex items-center justify-between border-b border-[var(--border-color)]/30 pb-2">
        <span className="text-xs font-bold text-[var(--text-light)] font-mono">Connect Service</span>
        <button id="llm-cancel-custom-provider-button" type="button" onClick={onCancel} className="text-[var(--color-status-danger)] hover:text-[var(--color-status-danger)] text-[10px] font-mono cursor-pointer">Cancel</button>
      </div>

      <div className="space-y-2 text-xs">
        <div className="space-y-1">
          <label htmlFor="llm-service-preset" className={LABEL_CLASS}>
            Service Type
          </label>
          <CustomSelect
            id="llm-service-preset"
            options={SERVICE_PRESET_OPTIONS}
            value={draft.preset}
            onChange={(value) => setDraft((prev) => withPreset(prev, value as PresetId))}
          />
        </div>

        <DraftField id="llm-custom-provider-name" label="Display Name" type="text" placeholder="e.g. My Ollama Server" value={draft.name} onChange={(name) => update({ name })} mono={false} required />
        <DraftField id="llm-custom-provider-url" label="Base API URL" type="text" placeholder="e.g. http://localhost:11434/v1" value={draft.url} onChange={(url) => update({ url })} required />
        <DraftField id="llm-api-key" label="API Key (Optional)" type="password" placeholder="Leave blank if not required" value={draft.apiKey} onChange={(apiKey) => update({ apiKey })} />
        <DraftField id="llm-model-id" label="Model ID (Optional)" type="text" placeholder="e.g. gpt-4, llama2, or leave empty to discover later" value={draft.model} onChange={(model) => update({ model })} />

        <div className="flex items-center space-x-2">
          <input
            id="llm-discover-after-save"
            type="checkbox"
            checked={draft.discoverAfterSave}
            onChange={(e) => update({ discoverAfterSave: e.target.checked })}
            className="w-4 h-4 rounded border-[var(--border-color)] cursor-pointer"
          />
          <label htmlFor="llm-discover-after-save" className="text-[9px] text-[var(--text-muted)] cursor-pointer">
            Discover available models after save
          </label>
        </div>

        <button
          id="llm-submit-custom-provider-button"
          type="submit"
          className="w-full bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/85 text-[var(--color-primary-foreground)] font-mono font-bold py-2 rounded-lg text-xs transition-all shadow-md cursor-pointer flex items-center justify-center space-x-1.5"
        >
          <Plus size={13} />
          <span>Save Configuration</span>
        </button>
      </div>
    </form>
  );
}
