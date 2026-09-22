import React from "react";
import { useNotificationStore } from "../notificationStore";
import { AlertModalView } from "./AlertModal.view";

export const AlertModal: React.FC = () => {
  const notification = useNotificationStore((s) => s.notification);
  const clear = useNotificationStore((s) => s.clear);

  return <AlertModalView notification={notification} clear={clear} />;
};
