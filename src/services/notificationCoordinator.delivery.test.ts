import { describe, expect, it, vi } from "vitest";
import { NotificationCoordinator } from "./notificationCoordinator";
import type { NotificationPresenter, UserInteractionRequest } from "./notificationTypes";

const request = (): UserInteractionRequest => ({
  requestId: "question-1",
  kind: "model_question",
  title: "Question",
  body: "Choose",
  actions: [{ id: "answer", label: "Send", input: { kind: "text", maxLength: 40 } }],
  createdAt: Date.now(),
});

describe("NotificationCoordinator delivery", () => {
  it("keeps the in-app fallback available when native delivery fails", async () => {
    let respond: ((response: Parameters<NotificationPresenter["present"]>[1] extends (response: infer T) => void ? T : never) => void) | undefined;
    const native: NotificationPresenter = {
      getCapabilities: () => ({ available: true, actionable: true, textInput: true }),
      present: async () => "failed",
      presentPassive: async () => "failed",
      cancel: async () => undefined,
      dispose: () => undefined,
    };
    const inApp: NotificationPresenter = {
      getCapabilities: () => ({ available: true, actionable: true, textInput: true }),
      present: async (_request, callback) => { respond = callback; return "presented"; },
      presentPassive: async () => "presented",
      cancel: async () => undefined,
      dispose: () => undefined,
    };
    const diagnostic = vi.fn();
    const coordinator = new NotificationCoordinator({ presenters: [native, inApp], onDiagnostic: diagnostic });
    const pending = coordinator.register(request());
    await vi.waitFor(() => expect(respond).toBeDefined());
    respond?.({ requestId: "question-1", actionId: "answer", inputValue: "yes", source: "in_app", respondedAt: Date.now() });
    await expect(pending).resolves.toMatchObject({ inputValue: "yes" });
    expect(diagnostic).toHaveBeenCalled();
  });
});
