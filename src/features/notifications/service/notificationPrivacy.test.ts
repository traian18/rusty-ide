import { describe, expect, it } from "vitest";
import { sanitizeNotificationText } from "./notificationPrivacy";

describe("notification privacy", () => {
  it("redacts credential-like command arguments", () => {
    expect(sanitizeNotificationText("curl token=top-secret password=hunter2")).toBe("curl token=[redacted] password=[redacted]");
  });

  it("bounds notification content", () => {
    expect(sanitizeNotificationText("x".repeat(400))).toHaveLength(300);
  });
});
