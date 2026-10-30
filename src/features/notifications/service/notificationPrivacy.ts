import type { PassiveNotification, UserInteractionRequest } from "./notificationTypes";

const SENSITIVE_ARGUMENT = /((?:token|secret|password|passwd|api[_-]?key|authorization|cookie))=?[^\s]*/gi;
const MAX_BODY_LENGTH = 300;

export function sanitizeNotificationText(value: string, maxLength = MAX_BODY_LENGTH): string {
  return value
    .replace(SENSITIVE_ARGUMENT, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function sanitizeInteractionForNotification(request: UserInteractionRequest): UserInteractionRequest {
  return {
    ...request,
    title: sanitizeNotificationText(request.title, 120),
    body: sanitizeNotificationText(request.body),
    metadata: undefined,
    routing: request.routing ? { ...request.routing, metadata: undefined } : undefined,
  };
}

export function sanitizePassiveNotification(notification: PassiveNotification): PassiveNotification {
  return {
    ...notification,
    title: sanitizeNotificationText(notification.title, 120),
    body: sanitizeNotificationText(notification.body),
    metadata: undefined,
    routing: notification.routing ? { ...notification.routing, metadata: undefined } : undefined,
  };
}
