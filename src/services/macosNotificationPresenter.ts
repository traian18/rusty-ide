import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { loadNotificationPolicy, permitsNativeNotification } from "../preferences/notificationPolicy";
import { sanitizeInteractionForNotification, sanitizePassiveNotification } from "./notificationPrivacy";
import type { NotificationCapabilities, NotificationPresenter, NotificationPresentationResult, PassiveNotification, UserInteractionRequest, UserInteractionResponse } from "./notificationTypes";

/** Tauri-backed presenter. The Rust boundary is intentionally capability based so web/non-macOS builds remain safe. */
export class MacosNotificationPresenter implements NotificationPresenter {
  private readonly pending = new Set<string>();
  private readonly callbacks = new Map<string, (response: UserInteractionResponse) => void>();
  private unlisten?: Promise<UnlistenFn>;
  private disposed = false;

  async getCapabilities(): Promise<NotificationCapabilities> {
    if (this.disposed) return { available: false, actionable: false, textInput: false };
    try { return await invoke<NotificationCapabilities>("notification_capabilities"); }
    catch { return { available: false, actionable: false, textInput: false }; }
  }

  async present(request: UserInteractionRequest, onResponse: (response: UserInteractionResponse) => void): Promise<NotificationPresentationResult> {
    if (!permitsNativeNotification(loadNotificationPolicy(), request.kind === "permission" ? "permission" : "model_question")) return "unavailable";
    const capabilities = await this.getCapabilities();
    if (!capabilities.available || !capabilities.actionable) return "unavailable";
    const actions = request.actions.filter((action) => !action.input || capabilities.textInput);
    try {
      await this.ensureResponseListener();
      await invoke("notification_present", { request: sanitizeInteractionForNotification({ ...request, actions }) });
      this.pending.add(request.requestId);
      this.callbacks.set(request.requestId, onResponse);
      return "presented";
    } catch { return "failed"; }
  }

  async presentPassive(notification: PassiveNotification): Promise<NotificationPresentationResult> {
    if (!permitsNativeNotification(loadNotificationPolicy(), "run_status")) return "unavailable";
    try {
      const sanitized = sanitizePassiveNotification(notification);
      await invoke("notification_present_passive", {
        notification: {
          requestId: sanitized.notificationId ?? `passive:${Date.now()}`,
          title: sanitized.title,
          body: sanitized.body,
          actions: [],
        },
      });
      return "presented";
    }
    catch { return "failed"; }
  }

  async cancel(requestId: string): Promise<void> {
    this.pending.delete(requestId); this.callbacks.delete(requestId);
    try { await invoke("notification_cancel", { requestId }); } catch { /* fallback remains available */ }
  }

  dispose(): void {
    this.disposed = true;
    this.pending.clear();
    this.callbacks.clear();
    void this.unlisten?.then((unlisten) => unlisten());
  }

  private async ensureResponseListener(): Promise<void> {
    this.unlisten ??= listen<UserInteractionResponse>("rusty://notification-response", (event) => {
      const response = event.payload;
      if (response.source !== "macos_notification" || !this.pending.has(response.requestId)) return;
      const callback = this.callbacks.get(response.requestId);
      if (!callback) return;
      callback(response);
    });
    await this.unlisten;
  }
}

const macosNotificationResponses = new Map<string, (response: UserInteractionResponse) => void>();
export function deliverMacosNotificationResponse(response: UserInteractionResponse): boolean {
  const callback = macosNotificationResponses.get(response.requestId);
  if (!callback || response.source !== "macos_notification") return false;
  callback(response); return true;
}
