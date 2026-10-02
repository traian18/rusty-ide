import React, { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { commandPermissionService } from "../../services/commandPermissionService";
import { inAppNotificationPresenter } from "../../services/notificationRuntime";
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
    <CommandPermissionDialog request={request} onDecision={(decision) => inAppNotificationPresenter.respond({ requestId: request.requestId, actionId: decision === "allow_once" ? "allow" : decision, source: "in_app", respondedAt: Date.now() })} />,
    document.body,
  );
};
