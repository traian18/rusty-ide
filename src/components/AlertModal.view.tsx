import React from "react";
import { CheckCircle2, AlertCircle, Info, AlertTriangle } from "lucide-react";
import { Modal } from "./ui/Modal/Modal";
import { Button } from "./ui/Button/Button";
import { Callout } from "./ui/Callout/Callout";
import type { CalloutVariant } from "./ui/Callout/Callout";

export const variantConfig = {
  success: { Icon: CheckCircle2, calloutVariant: "success" as CalloutVariant, titleDefault: "Success" },
  error: { Icon: AlertCircle, calloutVariant: "danger" as CalloutVariant, titleDefault: "Error" },
  info: { Icon: Info, calloutVariant: "info" as CalloutVariant, titleDefault: "Info" },
  danger: { Icon: AlertTriangle, calloutVariant: "danger" as CalloutVariant, titleDefault: "Warning" },
} as const;

export type NotificationVariant = keyof typeof variantConfig;

interface AlertModalViewProps {
  notification: {
    variant: NotificationVariant;
    title?: string;
    message: string;
  } | null;
  clear: () => void;
}

export const AlertModalView: React.FC<AlertModalViewProps> = ({ notification, clear }) => {
  if (!notification) return null;

  const cfg = variantConfig[notification.variant];
  const isDanger = notification.variant === "error" || notification.variant === "danger";

  return (
    <Modal
      id="alert-modal"
      title={notification.title || cfg.titleDefault}
      icon={cfg.Icon}
      onClose={clear}
      size="sm"
      footer={
        <Button id="alert-modal-ok" type="button" variant={isDanger ? "danger" : "primary"} onClick={clear}>
          OK
        </Button>
      }
    >
      <Callout variant={cfg.calloutVariant}>
        <span className="whitespace-pre-wrap">{notification.message}</span>
      </Callout>
    </Modal>
  );
};
