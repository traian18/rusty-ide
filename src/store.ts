import { create } from "zustand";
import { createAgentSlice } from "./features/agent-chat/state";
import { createCanvasSlice } from "./features/canvas/state";
import { createTabsSlice } from "./app/state/tabs";
import { createTabUiSlice } from "./app/state/tabUi";
import { createGitSlice } from "./features/git";
import { createIntegrationSlice } from "./features/providers/state/integration";
import { createMetricsSlice } from "./features/observability/state";
import { createPreferencesSlice } from "./features/settings/state/preferences";
import { createProviderRegistrySlice } from "./features/providers/state/providerRegistry";
import { createSmartReadSlice } from "./features/settings/state/smartRead";
import { createIntelligentModelSelectionSlice } from "./features/providers/state/intelligentModelSelection";
import { createStartupSlice } from "./app/state/startup";
import { createTerminalSlice } from "./features/terminal/state";
import { createUpdateSlice } from "./features/updates/state";
import { createUiSlice } from "./app/state/ui";
import { createWorkspaceSlice } from "./app/state/workspace";
import type { WorkspaceState } from "./store/types";

export * from "./store/types";
export * from "./features/settings/service/smartReadTypes";
export * from "./features/providers/service/intelligentModelSelectionTypes";

export const useWorkspaceStore = create<WorkspaceState>()((...args) => ({
  ...createWorkspaceSlice(...args),
  ...createGitSlice(...args),
  ...createTerminalSlice(...args),
  ...createUiSlice(...args),
  ...createTabUiSlice(...args),
  ...createTabsSlice(...args),
  ...createCanvasSlice(...args),
  ...createAgentSlice(...args),
  ...createIntegrationSlice(...args),
  ...createMetricsSlice(...args),
  ...createPreferencesSlice(...args),
  ...createProviderRegistrySlice(...args),
  ...createSmartReadSlice(...args),
  ...createIntelligentModelSelectionSlice(...args),
  ...createStartupSlice(...args),
  ...createUpdateSlice(...args),
}) as WorkspaceState);
