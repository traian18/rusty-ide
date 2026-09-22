import React, { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { commandPermissionService } from "../../services/commandPermissionService";
import { CommandPermissionDialog } from "./CommandPermissionDialog";

/** Connects the shared permission service to a single app-level dialog view. */
export const CommandPermissionPresenter: React.FC = () => {
  const request = useSyncExternalStore(
    commandPermissionService.subscribe,
    commandPermissionService.getSnapshot,
    commandPermissionService.getSnapshot,
  );
  if (!request) return null;
  return createPortal(
    <CommandPermissionDialog request={request} onDecision={(decision) => commandPermissionService.resolve(request.requestId, decision)} />,
    document.body,
  );
};
