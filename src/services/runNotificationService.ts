import { notificationCoordinator } from "./notificationRuntime";
import type { NotificationRouting } from "./notificationTypes";

export type RunNotificationStatus = "completed" | "failed" | "stopped" | "waiting_for_approval" | "waiting_for_response";

export function notifyRunStatus(status: RunNotificationStatus, label: string, routing?: NotificationRouting): void {
  const messages: Record<RunNotificationStatus, { title: string; body: string }> = {
    completed: { title: "Rusty · Run completed", body: `${label} completed successfully.` },
    failed: { title: "Rusty · Run failed", body: `${label} needs attention.` },
    stopped: { title: "Rusty · Run stopped", body: `${label} was stopped.` },
    waiting_for_approval: { title: "Rusty · Approval required", body: `${label} is waiting for your approval.` },
    waiting_for_response: { title: "Rusty · Response required", body: `${label} is waiting for your response.` },
  };
  const notification = messages[status];
  void notificationCoordinator.notify({
    notificationId: `run:${status}:${routing?.runId ?? routing?.tabId ?? label}`.replace(/[^a-zA-Z0-9:_-]/g, "-"),
    category: status === "waiting_for_approval" ? "rusty.permission" : status === "waiting_for_response" ? "rusty.model_question" : "rusty.run_status",
    ...notification,
    routing,
    createdAt: Date.now(),
  });
}
