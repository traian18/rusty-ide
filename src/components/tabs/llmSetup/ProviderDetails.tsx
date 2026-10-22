import { HelpCircle as HelpIcon, Layers, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { useWorkspaceStore, type CustomProvider } from "../../../store";
import { isManagedAuthProvider, providerModelVariants } from "../../../store/providerHelpers";
import { providerStatusOrUnknown } from "../../../integrations/registryTypes";
import { CustomSelect } from "../../CustomSelect";
import { managedAuthCopy } from "./managedAuth";
import { ManagedAuthPanel } from "./ManagedAuthPanel";
import { modelOptions } from "./providerDraft";
import { providerHelpText } from "./providerHelp";
import { ProviderSettingsForm } from "./ProviderSettingsForm";
import { FieldLabel } from "./settingFields";
import { useProviderChecks, type ProviderChecks } from "./useProviderChecks";
import { useProviderDraft } from "./useProviderDraft";

/** Settings, default model and connection checks of the selected provider. */
export function ProviderDetails({ provider }: { provider: CustomProvider }) {
  const providerStatus = useWorkspaceStore((state) => state.providerStatus);
  const editor = useProviderDraft(provider);
  const checks = useProviderChecks(editor.draft);
  const managed = isManagedAuthProvider(provider);
  const status = providerStatusOrUnknown(providerStatus, provider.id);
  const copy = managedAuthCopy(provider);
  const signInPending = managed && status.kind !== "ready";
  const canSave = editor.validation.valid && !checks.busy;

  return (
    <div className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-2xl p-6 space-y-6">
      <div className="flex items-center justify-between border-b border-[var(--border-color)]/30 pb-4">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] font-mono tracking-wider">Provider Configuration</span>
          <span className="text-lg font-bold text-[var(--text-light)]">{provider.name} Settings</span>
        </div>
        <div className="flex items-center space-x-1 bg-[var(--bg-app)] border border-[var(--border-color)] rounded-full px-3 py-1 font-mono text-[10px] text-[var(--text-muted)]">
          <span>ID:</span><span className="font-bold text-[var(--text-light)]">{provider.id}</span>
        </div>
      </div>

      <div className="space-y-4 text-xs">
        {managed ? (
          <ManagedAuthPanel provider={provider} status={status} copy={copy} />
        ) : (
          <ProviderSettingsForm draft={editor.draft} setDraft={editor.setDraft} validation={editor.validation} showKey={editor.showKey} onToggleShowKey={editor.toggleShowKey} />
        )}
        <DefaultModelPicker
          provider={provider}
          placeholder={signInPending ? `Sign in with ${copy.vendor} to load ${copy.product} models` : "No supported models available - update the provider catalogue"}
        />
        <ProviderActions checks={checks} checksDisabled={checks.busy || signInPending} save={managed ? undefined : { disabled: !canSave, onClick: editor.save }} />
      </div>

      <div className="bg-[var(--bg-app)] border border-[var(--border-color)] rounded-xl p-4.5 flex items-start space-x-3.5">
        <HelpIcon size={18} className="text-[var(--accent-color)] flex-shrink-0 mt-0.5" />
        <div className="flex flex-col space-y-1"><span className="text-xs font-bold text-[var(--text-light)]">Integration Guide</span><p className="text-[11px] text-[var(--text-muted)] leading-relaxed font-sans">{providerHelpText(provider.id)}</p></div>
      </div>
    </div>
  );
}

function DefaultModelPicker({ provider, placeholder }: { provider: CustomProvider; placeholder: string }) {
  const activeModel = useWorkspaceStore((state) => state.activeModel);
  const setActiveModel = useWorkspaceStore((state) => state.setActiveModel);
  const listsEfforts = provider.models.some((model) => providerModelVariants(model).length > 1);
  const hiddenCount = provider.models.filter((model) => model.supported === false).length;

  return (
    <div className="space-y-2 pt-2">
      <FieldLabel icon={Layers}>Default Target Model</FieldLabel>
      <CustomSelect value={activeModel} onChange={setActiveModel} options={modelOptions(provider)} placeholder={placeholder} />
      {listsEfforts && <span className="text-[10px] text-[var(--text-muted)] font-mono">Reasoning-capable models are listed once per supported effort; the selected effort is sent with every request.</span>}
      {hiddenCount > 0 && <span className="text-[10px] text-[var(--text-muted)] font-mono">{hiddenCount} catalog entries are hidden because their protocol or tool capabilities are not supported.</span>}
    </div>
  );
}

interface ProviderActionsProps {
  checks: ProviderChecks;
  checksDisabled: boolean;
  /** Absent for managed-auth providers, whose settings are not editable. */
  save?: { disabled: boolean; onClick: () => void };
}

function ProviderActions({ checks, checksDisabled, save }: ProviderActionsProps) {
  const activeModel = useWorkspaceStore((state) => state.activeModel);

  return (
    <div className="pt-4 flex flex-col space-y-3.5 border-t border-[var(--border-color)]/30">
      <div className="flex flex-wrap items-center gap-2">
        <button id="llm-update-model-catalogue-button" type="button" onClick={checks.fetchModels} disabled={checksDisabled} className="whitespace-nowrap border border-[var(--border-color)] hover:border-[var(--accent-color)] bg-[var(--bg-app)] hover:bg-[var(--accent-bg)]/10 text-[var(--text-normal)] hover:text-[var(--text-light)] font-mono font-bold px-4 py-2.5 rounded-xl transition-all cursor-pointer flex items-center space-x-1.5 disabled:opacity-50" title="Discover and update the provider's shared model catalogue">
          <RefreshCw size={13} className={checks.fetchingModels ? "animate-spin text-[var(--accent-color)]" : ""} /><span>{checks.fetchingModels ? "Updating..." : "Update Model Catalogue"}</span>
        </button>
        <button id="llm-test-connection-button" type="button" onClick={checks.testConnection} disabled={checksDisabled} className="whitespace-nowrap border border-[var(--border-color)] hover:border-[var(--color-status-success-border)] bg-[var(--bg-app)] hover:bg-[var(--color-status-success-bg)] text-[var(--text-normal)] hover:text-[var(--text-light)] font-mono font-bold px-4 py-2.5 rounded-xl transition-all cursor-pointer flex items-center space-x-1.5 disabled:opacity-50">
          <ShieldCheck size={13} className={checks.testingConnection ? "animate-pulse text-[var(--color-status-success)]" : ""} /><span>{checks.testingConnection ? "Testing..." : "Test"}</span>
        </button>
        {save && <button id="llm-save-configuration-button" type="button" onClick={save.onClick} disabled={save.disabled} className="whitespace-nowrap bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/85 text-[var(--color-primary-foreground)] font-mono font-bold px-4 py-2.5 rounded-xl transition-all shadow-lg hover:shadow-[var(--accent-color)]/20 cursor-pointer flex items-center space-x-1.5"><Save size={13} /><span>Save Configuration</span></button>}
      </div>
      <div className="flex items-center space-x-1.5 text-[10px] font-mono text-[var(--text-muted)] bg-[var(--bg-app)]/50 border border-[var(--border-color)]/40 rounded-lg px-2.5 py-1.5 w-fit">
        <ShieldCheck size={14} className="text-[var(--color-status-success)]" />
        <span>Active Model: {activeModel || "None selected"}</span>
      </div>
    </div>
  );
}
