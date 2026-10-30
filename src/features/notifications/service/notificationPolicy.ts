export interface NotificationPolicy {
  nativeWhenInactive: boolean;
  approvals: boolean;
  modelQuestions: boolean;
  runStatus: boolean;
}

const STORAGE_KEY = "rusty.notification-policy";

export const defaultNotificationPolicy: NotificationPolicy = {
  nativeWhenInactive: true,
  approvals: true,
  modelQuestions: true,
  runStatus: true,
};

export function loadNotificationPolicy(): NotificationPolicy {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...defaultNotificationPolicy, ...JSON.parse(raw) } : defaultNotificationPolicy;
  } catch {
    return defaultNotificationPolicy;
  }
}

export function saveNotificationPolicy(policy: NotificationPolicy): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(policy));
}

export function permitsNativeNotification(policy: NotificationPolicy, kind: "permission" | "model_question" | "run_status"): boolean {
  if (policy.nativeWhenInactive && typeof document !== "undefined" && document.visibilityState === "visible") return false;
  return kind === "permission" ? policy.approvals : kind === "model_question" ? policy.modelQuestions : policy.runStatus;
}
