/** Every command the native notification presenter calls. */
import { invoke } from "@tauri-apps/api/core";
import type { NotificationCapabilities } from "./service/notificationTypes";

/** Calls a Tauri command by name. The app passes the real bridge; tests pass a fake one. */
export type Invoke = <T>(command: string, args: Record<string, unknown>) => Promise<T>;

export interface NotificationClient {
  capabilities(): Promise<NotificationCapabilities>;
  /** Shows an actionable notification; `request` is already sanitized. */
  present(request: unknown): Promise<void>;
  requestAuthorization(): Promise<boolean>;
  presentPassive(notification: { requestId: string; title: string; body: string; actions: unknown[] }): Promise<void>;
  cancel(requestId: string): Promise<void>;
}

/** Builds the notification client on a command bridge. Each method names one Tauri command and its arguments. */
export function createNotificationClient(call: Invoke): NotificationClient {
  return {
    capabilities: () => call<NotificationCapabilities>("notification_capabilities", {}),
    present: (request) => call<void>("notification_present", { request }),
    requestAuthorization: () => call<boolean>("notification_request_authorization", {}),
    presentPassive: (notification) => call<void>("notification_present_passive", { notification }),
    cancel: (requestId) => call<void>("notification_cancel", { requestId }),
  };
}

export const notificationClient = createNotificationClient(invoke);
