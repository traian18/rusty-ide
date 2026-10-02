import React, { useSyncExternalStore } from "react";
import { inAppNotificationPresenter } from "../services/notificationRuntime";
import type { UserInteractionRequest } from "../services/notificationTypes";

export const NotificationInteractionPresenter: React.FC = () => {
  const requests = useSyncExternalStore(
    inAppNotificationPresenter.subscribe,
    inAppNotificationPresenter.getPending.bind(inAppNotificationPresenter),
    inAppNotificationPresenter.getPending.bind(inAppNotificationPresenter),
  );
  const request = requests[0];
  if (!request) return null;
  return <InteractionView request={request} />;
};

const InteractionView: React.FC<{ request: UserInteractionRequest }> = ({ request }) => {
  const [value, setValue] = React.useState("");
  const submit = (actionId: string) => {
    const action = request.actions.find((candidate) => candidate.id === actionId);
    const input = action?.input;
    const inputValue = input ? value.trim() : undefined;
    if (input && !inputValue) return;
    inAppNotificationPresenter.respond({
      requestId: request.requestId,
      actionId,
      inputValue,
      source: "in_app",
      respondedAt: Date.now(),
    });
  };
  return (
    <div role="dialog" aria-label={request.title} className="fixed bottom-4 right-4 z-50 max-w-md rounded-lg bg-[var(--bg-panel)] p-4 shadow-xl">
      <h2 className="text-base font-semibold">{request.title}</h2>
      <p className="mt-2 text-sm">{request.body}</p>
      {request.actions.some((action) => action.input) && (
        <input id={`notification-input-${request.requestId}`} value={value} onChange={(event) => setValue(event.target.value)} maxLength={request.actions.find((action) => action.input)?.input?.maxLength} className="mt-3 w-full" />
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {request.actions.map((action) => <button id={`notification-action-${request.requestId}-${action.id}`} key={action.id} type="button" onClick={() => submit(action.id)}>{action.label}</button>)}
      </div>
    </div>
  );
};
