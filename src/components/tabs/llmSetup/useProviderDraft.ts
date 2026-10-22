import { useEffect, useMemo, useState } from "react";
import { useWorkspaceStore, type CustomProvider } from "../../../store";
import { notify } from "../../../notificationStore";
import { validateDraft } from "./providerDraft";

/** Unsaved edits to the selected provider; selecting another provider starts over. */
export function useProviderDraft(provider: CustomProvider) {
  const updateProviderSettings = useWorkspaceStore((state) => state.updateProviderSettings);
  const [draft, setDraft] = useState<CustomProvider>(provider);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    setDraft(provider);
    setShowKey(false);
  }, [provider]);

  const validation = useMemo(() => validateDraft(draft), [draft]);

  const save = () => {
    if (!validation.valid) return;
    updateProviderSettings(draft.id, draft);
    notify("Saved", `Connection settings updated for ${draft.name}.`, "success");
  };

  return { draft, setDraft, validation, showKey, toggleShowKey: () => setShowKey(!showKey), save };
}
