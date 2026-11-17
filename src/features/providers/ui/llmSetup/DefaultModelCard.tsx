import { useEffect } from "react";
import { Star } from "lucide-react";
import { useWorkspaceStore } from "../../../../store";
import { CustomSelect } from "../../../../lib/ui/CustomSelect";
import { buildSelectableModels } from "../useSelectableModels";
import { concreteDefaultModel, defaultChatModel, isAutoSelectionAvailable, isModelUsable } from "../../service/chatModel";
import { AUTO_MODEL_ID } from "../../service/intelligentModelSelector";

/** The one default model, across every connected provider: every new chat starts on it, and a chat
 * whose own model can no longer run falls back to it. With none set (or the set one gone), the first
 * model a connected provider offers becomes the default. AUTO is offered while JEV can run it, and
 * stays the default while it briefly cannot (chats then start on a concrete model). */
export function DefaultModelCard() {
  const customProviders = useWorkspaceStore((state) => state.customProviders);
  const providerStatus = useWorkspaceStore((state) => state.providerStatus);
  const defaultModel = useWorkspaceStore((state) => state.activeModel);
  const setActiveModel = useWorkspaceStore((state) => state.setActiveModel);
  const configLoaded = useWorkspaceStore((state) => state.secureConfigLoaded);
  const autoAvailable = useWorkspaceStore((state) => isAutoSelectionAvailable(state));
  const standIn = useWorkspaceStore((state) => concreteDefaultModel(state));
  const { options: models } = buildSelectableModels(customProviders, providerStatus, null);
  const options = autoAvailable ? [{ id: AUTO_MODEL_ID, name: "AUTO — Intelligent model selection" }, ...models] : models;
  const isAuto = defaultModel === AUTO_MODEL_ID;
  const usable = isAuto ? autoAvailable : isModelUsable(defaultModel, customProviders, providerStatus);
  const standInName = models.find((option) => option.id === standIn)?.name ?? standIn;

  useEffect(() => {
    if (!configLoaded || usable || isAuto) return;
    const next = defaultChatModel("", customProviders, providerStatus);
    if (next && next !== defaultModel) setActiveModel(next);
  }, [configLoaded, customProviders, defaultModel, isAuto, providerStatus, setActiveModel, usable]);

  return (
    <div className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-2xl p-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-3">
        <Star size={18} className="text-[var(--accent-color)] flex-shrink-0 mt-0.5" />
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-bold text-[var(--text-light)]">Default model</span>
          <p className="text-[11px] text-[var(--text-muted)] max-w-md">
            Every new chat starts on this model. A chat keeps the model you pick for it; if that model's provider is removed or disconnected, the chat moves to this one.
          </p>
          {isAuto && standIn && (
            <p className="text-[11px] text-[var(--text-muted)] max-w-md">
              {autoAvailable
                ? `Features without AUTO (inline chat, canvas, wiki) use the Standard level's model, ${standInName}.`
                : `AUTO cannot run right now, so chats start on ${standInName} until it can.`}
            </p>
          )}
        </div>
      </div>
      <CustomSelect
        id="llm-default-model-select"
        value={usable ? defaultModel : ""}
        onChange={setActiveModel}
        options={options}
        placeholder={options.length === 0 ? "Connect a provider to choose a default model" : "Select default model"}
        className="w-full md:w-72"
      />
    </div>
  );
}
