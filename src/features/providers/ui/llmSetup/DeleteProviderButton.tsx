import { Trash2 } from "lucide-react";
import { useWorkspaceStore, type CustomProvider } from "../../../../store";
import { useConfirm } from "../../../../lib/ui/useConfirm";
import { notify } from "../../../notifications";
import { isManagedAuthProvider } from "../../service/providerHelpers";
import { isBuiltInProvider } from "../../service/chatModel";
import { defaultProviders } from "../../state/integrationDefaults";

/** Deletes a provider the user added, or resets a built-in one (its key, headers and catalogue
 * cleared). Signed-in providers (Copilot, Codex) are left to their own sign-out. */
export function DeleteProviderButton({ provider }: { provider: CustomProvider }) {
  const deleteProvider = useWorkspaceStore((state) => state.deleteProvider);
  const { confirm, ConfirmModalComponent } = useConfirm();
  if (isManagedAuthProvider(provider)) return null;
  const builtIn = isBuiltInProvider(provider.id, defaultProviders);
  const label = builtIn ? "Remove connection" : "Delete integration";

  const onClick = async () => {
    const confirmed = await confirm({
      title: builtIn ? `Remove the ${provider.name} connection?` : `Delete ${provider.name}?`,
      message: builtIn
        ? `This clears ${provider.name}'s API key, headers and discovered models. ${provider.name} stays in the list so you can connect it again. Chats on its models move to the default model. This can't be undone.`
        : `This deletes the ${provider.name} integration with its API key and models. Chats on its models move to the default model. This can't be undone.`,
      confirmLabel: label,
      kind: "danger",
    });
    if (!confirmed) return;
    deleteProvider(provider.id);
    notify(builtIn ? "Connection removed" : "Integration deleted", builtIn ? `${provider.name} was reset.` : `${provider.name} was deleted.`, "success");
  };

  return (
    <>
      <button
        id="llm-delete-provider-button"
        type="button"
        onClick={() => void onClick()}
        className="whitespace-nowrap border border-[var(--color-status-danger-border)] hover:bg-[var(--color-status-danger-bg)] text-[var(--color-status-danger)] font-mono font-bold px-3 py-1.5 rounded-xl transition-all cursor-pointer flex items-center space-x-1.5 text-[11px]"
      >
        <Trash2 size={13} /><span>{label}</span>
      </button>
      {ConfirmModalComponent}
    </>
  );
}
