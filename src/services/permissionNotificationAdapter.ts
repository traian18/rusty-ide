import type { CommandPermissionDecision, CommandPermissionRequest } from "./commandPermissionService";
import type { UserInteractionRequest, UserInteractionResponse } from "./notificationTypes";

export function permissionRequestToInteraction(request: CommandPermissionRequest): UserInteractionRequest {
  const commandSummary = [request.command.program, ...request.command.args].join(" ");
  return {
    requestId: request.requestId,
    kind: "permission",
    title: "Command approval required",
    body: request.description || commandSummary,
    actions: [
      { id: "allow", label: "Allow", isDefault: true },
      { id: "allow_session", label: "Allow for session" },
      { id: "deny", label: "Deny", style: "destructive" },
    ],
    routing: { sessionId: request.sessionId },
    createdAt: Date.now(),
    deduplicationKey: `${request.sessionId}:${request.requestId}`,
    metadata: { risk: request.risk, command: request.command.program },
  };
}

export function interactionResponseToPermission(response: UserInteractionResponse): CommandPermissionDecision | null {
  switch (response.actionId) {
    case "allow":
    case "allow_once":
      return "allow_once";
    case "allow_session":
      return "allow_session";
    case "deny":
    case "reject":
      return "deny";
    default:
      return null;
  }
}
