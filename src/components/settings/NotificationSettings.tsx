import React from "react";
import { loadNotificationPolicy, saveNotificationPolicy, type NotificationPolicy } from "../../preferences/notificationPolicy";
import { macosNotificationPresenter } from "../../services/notificationRuntime";

const controls: Array<{ key: keyof NotificationPolicy; label: string; description: string }> = [
  { key: "nativeWhenInactive", label: "Only when Rusty is not active", description: "Keep native notifications quiet while you are already using Rusty." },
  { key: "approvals", label: "Command approvals", description: "Notify when a command needs your approval." },
  { key: "modelQuestions", label: "Model questions", description: "Notify when the model needs your response." },
  { key: "runStatus", label: "Run status", description: "Notify when runs complete, fail, or stop." },
];

export function NotificationSettings() {
  const [policy, setPolicy] = React.useState(loadNotificationPolicy);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<string | null>(null);
  const sendTestNotification = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await macosNotificationPresenter.sendTestNotification();
      setTestResult(
        result.status === "sent"
          ? "Test notification sent. Check Notification Center."
          : result.status === "denied"
            ? "macOS denied notification permission. Enable Rusty in System Settings → Notifications, then try again."
            : `Native notifications are unavailable${result.error ? `: ${result.error}` : ". Launch the Tauri desktop app (npm run tauri -- dev), not the Vite browser preview."}`,
      );
    } catch {
      setTestResult("The test notification could not be sent. Check Rusty and macOS notification permissions.");
    } finally {
      setTesting(false);
    }
  };
  const update = (key: keyof NotificationPolicy, value: boolean) => {
    const next = { ...policy, [key]: value };
    setPolicy(next);
    saveNotificationPolicy(next);
  };
  return <section aria-labelledby="notification-settings-heading">
    <h2 id="notification-settings-heading">Notifications</h2>
    <p>Rusty always keeps approvals and questions available in-app. Native macOS delivery is optional.</p>
    {controls.map((control) => <label key={control.key} htmlFor={`notification-policy-${control.key}`}>
      <input id={`notification-policy-${control.key}`} type="checkbox" checked={policy[control.key]} onChange={(event) => update(control.key, event.target.checked)} />
      <strong>{control.label}</strong><span>{control.description}</span>
    </label>)}
    <div>
      <p id="notification-test-description">Use this to request macOS notification permission and send a harmless Rusty notification.</p>
      <button id="notification-send-test-button" type="button" aria-describedby="notification-test-description" onClick={() => void sendTestNotification()} disabled={testing}>
        {testing ? "Sending test notification…" : "Send test notification"}
      </button>
      {testResult && <p id="notification-test-result" role="status">{testResult}</p>}
    </div>
  </section>;
}
