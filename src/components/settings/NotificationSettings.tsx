import React from "react";
import { loadNotificationPolicy, saveNotificationPolicy, type NotificationPolicy } from "../../preferences/notificationPolicy";

const controls: Array<{ key: keyof NotificationPolicy; label: string; description: string }> = [
  { key: "nativeWhenInactive", label: "Only when Rusty is not active", description: "Keep native notifications quiet while you are already using Rusty." },
  { key: "approvals", label: "Command approvals", description: "Notify when a command needs your approval." },
  { key: "modelQuestions", label: "Model questions", description: "Notify when the model needs your response." },
  { key: "runStatus", label: "Run status", description: "Notify when runs complete, fail, or stop." },
];

export function NotificationSettings() {
  const [policy, setPolicy] = React.useState(loadNotificationPolicy);
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
  </section>;
}
