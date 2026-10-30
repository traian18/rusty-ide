import React from "react";
import { HeaderView } from "./Header.view";
import { ProviderQuotaControl } from "../features/providers/ui";
import { useWorkspaceStore } from "../store";
import { formatShortcut } from "../features/settings";
import { ToolExecutionButton } from "../features/observability/ui";

interface HeaderProps {
  onSearchOpen: () => void;
  toolExecutionOpen: boolean;
  onToolExecutionToggle: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onSearchOpen, toolExecutionOpen, onToolExecutionToggle }) => {
  const openSearchShortcut = useWorkspaceStore((state) => state.keyboardShortcuts.openSearch);
  return (
    <HeaderView
      onSearchOpen={onSearchOpen}
      searchShortcut={formatShortcut(openSearchShortcut)}
      toolExecutionControl={<ToolExecutionButton open={toolExecutionOpen} onToggle={onToolExecutionToggle} />}
      quotaControl={<ProviderQuotaControl />}
    />
  );
};
