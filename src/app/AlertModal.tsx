import React from "react";
import { useNotificationStore } from "../features/notifications";
import { AlertModalView } from "../lib/ui/AlertModal.view";

export const AlertModal: React.FC = () => {
  const notification = useNotificationStore((s) => s.notification);
  const clear = useNotificationStore((s) => s.clear);

  return <AlertModalView notification={notification} clear={clear} />;
};
