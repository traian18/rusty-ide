import { describe, expect, it } from "vitest";
import { interactionResponseToPermission, permissionRequestToInteraction } from "./permissionNotificationAdapter";
import type { CommandPermissionRequest } from "./commandPermissionService";

const request: CommandPermissionRequest = {
  requestId: "p1", sessionId: "s1", command: { program: "git", args: ["status"], cwd: "/tmp", timeoutMs: 1000 },
  risk: "normal", sessionGrantScope: "executable", sessionGrantProgram: "git", description: "Check repository status",
};

describe("permissionNotificationAdapter", () => {
  it("maps permission requests and decisions", () => {
    expect(permissionRequestToInteraction(request)).toMatchObject({ requestId: "p1", kind: "permission" });
    expect(interactionResponseToPermission({ requestId: "p1", actionId: "allow", source: "in_app", respondedAt: 1 })).toBe("allow_once");
    expect(interactionResponseToPermission({ requestId: "p1", actionId: "allow_session", source: "macos_notification", respondedAt: 1 })).toBe("allow_session");
    expect(interactionResponseToPermission({ requestId: "p1", actionId: "reject", source: "in_app", respondedAt: 1 })).toBe("deny");
  });
});
